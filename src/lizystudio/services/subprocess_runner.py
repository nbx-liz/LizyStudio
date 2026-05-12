"""Subprocess job runner (H-0036).

Executes fit/tune jobs in a child process to avoid OpenMP daemon-thread
degradation.  The parent process launches a subprocess that:

1. Reconstructs the backend adapter and loads the DataFrame from disk.
2. Runs ``run_fit`` / ``run_tune`` (same code path as thread mode).
3. Writes progress messages as JSONL to a temp file.
4. Persists results via ``JobStore`` (same disk layout).

The parent polls the progress file and forwards messages to the
``ProgressBroadcaster`` for WebSocket delivery.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from lizystudio.services.jobs import Job, JobStore

if TYPE_CHECKING:
    from lizystudio.ws.progress import ProgressBroadcaster

_logger = logging.getLogger(__name__)

_POLL_INTERVAL = 0.2  # seconds between progress file polls
# Hard cap on how long we wait for the subprocess to exit after polling
# has ended or after a cancel-triggered terminate. Chosen large enough
# for normal tail flushing but small enough that a hung child does not
# keep the daemon worker thread alive forever (H-0062 Bugfix 2026-04-14).
_WAIT_TIMEOUT = 10.0

# Issue #87: after the subprocess exits, retry the progress reader a
# handful of times so writes that the child flushed moments before
# ``SIGTERM`` still land on the parent's WebSocket broadcaster. The
# legacy single 50 ms sleep was unreliable on NFS / docker overlay2
# where the flush->visibility delay is occasionally above that budget.
_FINAL_FLUSH_RETRIES = 5
_FINAL_FLUSH_INTERVAL = 0.05

# Issue #328: ``execution.log`` size cap. The parent passes a writable
# file descriptor as the child's ``stdout`` (with ``stderr`` merged via
# ``subprocess.STDOUT``), so a runaway child could fill the disk through
# this single artifact. After the child exits we read the file size and,
# if it exceeds ``_MAX_LOG_BYTES``, atomically rewrite the file as
# ``_TRUNCATION_MARKER`` + the last ``_MAX_LOG_BYTES - len(marker)``
# bytes. Tail-keeping fits the diagnostic use case (the dialog reads
# what the user wants to debug — the failure). The cap also provides
# the bounded buffer that ``_StderrDrainer`` previously enforced for
# the in-memory ring; the kernel handles the running-write case (no
# pipe buffer involved when stdout is a file descriptor).
_MAX_LOG_BYTES = 10 * 1024 * 1024
_TRUNCATION_MARKER = b"... [truncated; head dropped to fit 10 MiB cap] ...\n"


def _truncate_log_if_needed(path: Path, max_bytes: int = _MAX_LOG_BYTES) -> None:
    """Cap ``path`` at ``max_bytes`` by keeping the tail.

    No-op when the file is missing or already under the cap. On OS
    errors the cap is best-effort: log a warning and leave the file
    alone rather than risk losing diagnostic output.
    """
    try:
        size = path.stat().st_size
    except OSError:
        return
    if size <= max_bytes:
        return
    keep_bytes = max_bytes - len(_TRUNCATION_MARKER)
    if keep_bytes <= 0:
        # max_bytes is smaller than the marker itself — write only the
        # marker so the file fits the cap and is still informative.
        try:
            path.write_bytes(_TRUNCATION_MARKER[:max_bytes])
        except OSError:
            _logger.warning("failed to truncate %s", path, exc_info=True)
        return
    try:
        with path.open("rb") as f:
            f.seek(size - keep_bytes)
            tail = f.read(keep_bytes)
        # Atomic-ish replace: write to a sibling tmp then rename. Same
        # filesystem so ``os.replace`` is atomic on POSIX.
        tmp_path = path.with_suffix(path.suffix + ".trunc")
        tmp_path.write_bytes(_TRUNCATION_MARKER + tail)
        os.replace(tmp_path, path)
    except OSError:
        _logger.warning("failed to truncate %s", path, exc_info=True)


def _read_log_tail(path: Path, n: int) -> bytes:
    """Return at most the last ``n`` bytes of ``path``.

    Returns ``b""`` when the file is missing or unreadable so callers
    in the failure-tail logging path do not have to handle exceptions.
    """
    try:
        with path.open("rb") as f:
            try:
                size = path.stat().st_size
            except OSError:
                return f.read()
            if size > n:
                f.seek(size - n)
            return f.read()
    except OSError:
        return b""


def run_job_in_subprocess(
    *,
    job: Job,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster | None,
    backend_name: str,
    data_path: str,
    mode: str = "job",
    parent_job_id: str | None = None,
    retune_n_trials: int = 0,
    retune_expand_boundary: bool | None = None,
    retune_boundary_threshold: float | None = None,
) -> Job:
    """Execute a job in a subprocess and return the updated Job.

    Progress is forwarded to *broadcaster* by polling a JSONL file
    written by the child process.

    When *mode* is ``"retune"`` (H-0062 Bugfix 2026-04-14), the child
    process runs :func:`lizystudio.services.training.run_retune` instead
    of ``run_fit`` / ``run_tune``. The additional ``parent_job_id`` and
    ``retune_*`` arguments are forwarded so the child can reconstruct
    the Re-tune inputs without needing the in-memory WorkspaceState
    from the parent process.

    Orchestrates three phases (extracted as private helpers for #452):
    :func:`_write_child_args` → :func:`_supervise_child` →
    :func:`_reconcile_subprocess_result`.
    """
    args_path, progress_path = _write_child_args(
        job=job,
        job_store=job_store,
        backend_name=backend_name,
        data_path=data_path,
        mode=mode,
        parent_job_id=parent_job_id,
        retune_n_trials=retune_n_trials,
        retune_expand_boundary=retune_expand_boundary,
        retune_boundary_threshold=retune_boundary_threshold,
    )
    returncode = _supervise_child(
        job=job,
        job_store=job_store,
        broadcaster=broadcaster,
        args_path=args_path,
        progress_path=progress_path,
    )
    return _reconcile_subprocess_result(
        job=job,
        job_store=job_store,
        broadcaster=broadcaster,
        returncode=returncode,
    )


def _write_child_args(
    *,
    job: Job,
    job_store: JobStore,
    backend_name: str,
    data_path: str,
    mode: str,
    parent_job_id: str | None,
    retune_n_trials: int,
    retune_expand_boundary: bool | None,
    retune_boundary_threshold: float | None,
) -> tuple[str, str]:
    """Serialize the child's launch arguments to a temp JSON file.

    Returns ``(args_path, progress_path)`` — the JSON arguments file the
    child reads and the (not-yet-created) JSONL progress file it appends
    to. Both live in the same temp directory so a single ``unlink`` pass
    in :func:`_supervise_child` cleans them up.

    Raises ``ValueError`` when *mode* is ``"retune"`` but the required
    ``parent_job_id`` / ``retune_n_trials`` arguments are missing — this
    fails before any subprocess is spawned.
    """
    args_dict: dict[str, Any] = {
        "job_id": job.job_id,
        "jobs_dir": str(job_store.jobs_dir),
        "backend_name": backend_name,
        "config": job.config,
        "data_path": data_path,
        "job_type": job.job_type,
        "mode": mode,
    }
    if mode == "retune":
        if parent_job_id is None:
            msg = "retune mode requires parent_job_id"
            raise ValueError(msg)
        if retune_n_trials <= 0:
            msg = f"retune mode requires retune_n_trials >= 1, got {retune_n_trials}"
            raise ValueError(msg)
        args_dict["parent_job_id"] = parent_job_id
        args_dict["retune_n_trials"] = retune_n_trials
        args_dict["retune_expand_boundary"] = retune_expand_boundary
        args_dict["retune_boundary_threshold"] = retune_boundary_threshold

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix="lzs_args_",
        delete=False,
    ) as args_file:
        json.dump(args_dict, args_file)
        args_path = args_file.name

    args_p = Path(args_path)
    progress_path = str(args_p.parent / (args_p.stem + "_progress.jsonl"))
    return args_path, progress_path


def _supervise_child(
    *,
    job: Job,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster | None,
    args_path: str,
    progress_path: str,
) -> int | None:
    """Launch the child, forward progress, wait for exit, then clean up.

    Returns the child's exit code (``proc.returncode``) so the caller
    can reconcile a non-terminal on-disk state. Returns ``None`` only if
    the child never produced an exit code (e.g. it survived the SIGKILL
    escalation window). If :func:`subprocess.Popen` itself fails the
    exception propagates after the cleanup ``finally`` runs.

    Issue #328: the child's stdout AND stderr are routed to
    ``execution.log`` via a parent-owned file descriptor so the UI's
    "View Full Log" dialog renders real content. Merging stderr into
    stdout (``stderr=subprocess.STDOUT``) preserves the chronological
    order of trace output and avoids the OS pipe-buffer deadlock that
    motivated #150 (no pipe in this path — writes go straight to file).
    """
    log_path = job_store.path_for(job.job_id, "log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_fp = log_path.open("ab")
    proc: subprocess.Popen[bytes] | None = None
    try:
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "lizystudio.services.subprocess_runner",
                args_path,
                progress_path,
            ],
            stdout=log_fp,
            stderr=subprocess.STDOUT,
        )

        # H-0062 Bugfix 2026-04-14 (5): pass job_store so _poll_progress
        # can honour cancel requests and terminate a hung subprocess.
        _poll_progress(
            proc, progress_path, job.job_id, broadcaster, job_store=job_store
        )
        # proc.wait() with a generous timeout: after cancel we want to
        # give the child a chance to flush the final "error" message
        # before killing it. If it doesn't exit within _WAIT_TIMEOUT the
        # escalation path below takes over.
        try:
            proc.wait(timeout=_WAIT_TIMEOUT)
        except subprocess.TimeoutExpired:
            _logger.warning(
                "Subprocess %s did not exit within %ss; killing",
                job.job_id,
                _WAIT_TIMEOUT,
            )
            proc.kill()
            with contextlib.suppress(subprocess.TimeoutExpired):
                proc.wait(timeout=_WAIT_TIMEOUT)
    finally:
        # Close the parent's fd before reading the file back so any
        # last buffered writes are flushed to disk. The child's own fd
        # was inherited and lives in the child process; ``proc.wait()``
        # above has already reaped that side. Truncation runs after
        # close so the rewrite-tail path observes the final size.
        with contextlib.suppress(Exception):
            log_fp.close()
        _truncate_log_if_needed(log_path)
        if proc is not None and proc.returncode not in (0, None):
            tail = _read_log_tail(log_path, n=4096).decode(errors="replace")
            _logger.error(
                "Subprocess exited with code %d: %s",
                proc.returncode,
                tail[-500:],
            )
        Path(args_path).unlink(missing_ok=True)
        Path(progress_path).unlink(missing_ok=True)
    return proc.returncode if proc is not None else None


def _reconcile_subprocess_result(
    *,
    job: Job,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster | None,
    returncode: int | None,
) -> Job:
    """Reload the job the child persisted and fix up a stuck state.

    If the child was killed mid-run (Cancel -> SIGTERM, or hard kill
    after ``_WAIT_TIMEOUT``) it never reached ``_run_job_core.finally``
    and so never wrote a terminal state back to disk. Reconcile here
    based on the cancel flag so waiters downstream (E2E, UI) see the
    final status instead of spinning on ``running`` forever.

    *returncode* is :func:`_supervise_child`'s return value; it appears
    in the "without persisting a terminal status" error message.
    """
    updated = job_store.get(job.job_id)
    if updated is None:
        # Fallback: mark as failed if subprocess didn't persist
        job.status = "failed"
        job.error = "Subprocess did not persist job result"
        return job

    if updated.status in ("pending", "running"):
        now = datetime.now(timezone.utc).isoformat()
        if job_store.is_cancel_requested(job.job_id):
            updated.status = "cancelled"
            if broadcaster is not None:
                broadcaster.send_error(
                    job.job_id, "Job cancelled", code="JOB_CANCELLED"
                )
        else:
            updated.status = "failed"
            updated.error = (
                f"Subprocess exited with code {returncode} "
                f"without persisting a terminal status"
            )
            if broadcaster is not None:
                broadcaster.send_error(job.job_id, updated.error)
        updated.completed_at = now
        job_store.update(updated)
        job_store.clear_cancel(job.job_id)
    return updated


class _ProgressReader:
    """Tail-read the progress JSONL file one new chunk at a time.

    Issue #87: the legacy poll loop read the whole progress file via
    ``Path.read_text().splitlines()`` on every 200 ms tick and tracked a
    consumed-line counter. That is O(N) per poll in the number of lines
    already seen, so a long tune with hundreds of trials quadratically
    degrades the parent thread as the file grows. It also silently
    dropped partial writes (a ``write()`` that landed but whose
    terminating newline had not flushed yet was parsed as invalid JSON
    and thrown away, never to be retried).

    This reader keeps an open file handle and reads only the new bytes
    since the last call (``file.read()`` on a regular file with a live
    offset). A small ``_buffer`` holds any unterminated trailing text
    across calls so it is never lost — the next call stitches the
    continuation on and returns the completed line.

    The reader also handles the common "file does not exist yet"
    startup case: ``_ensure_open`` retries on every call until the
    child creates the file, at which point the handle opens and
    subsequent calls stream from offset 0.
    """

    def __init__(self, path: str) -> None:
        self._path = path
        self._file: Any = None  # typing.IO[str] once opened
        self._buffer = ""

    def _ensure_open(self) -> bool:
        """Open the file lazily if it has appeared on disk.

        Returns True if a live handle is available after the call, and
        False if the file still does not exist.
        """
        if self._file is not None:
            return True
        if not Path(self._path).exists():
            return False
        # Text mode with UTF-8 to match _write_progress; errors="replace"
        # so a corrupt byte sequence in the middle of a long tune does
        # not raise UnicodeDecodeError and kill the poll loop. A broken
        # line will fail JSON parsing in _forward_progress and be
        # dropped there with logging, which is the right failure mode.
        self._file = open(  # noqa: SIM115 — handle lives with the reader
            self._path, encoding="utf-8", errors="replace"
        )
        return True

    def read_new_lines(self) -> list[str]:
        """Return complete lines written since the last call.

        Any partial trailing content (no terminating newline) is stashed
        on ``self._buffer`` and only released once its continuation has
        been written.
        """
        if not self._ensure_open():
            return []
        chunk = self._file.read()
        if not chunk:
            return []
        data = self._buffer + chunk
        # If the chunk ends with a newline, every line is complete and
        # the buffer is empty; otherwise the last fragment is partial
        # and we hold it until a later call completes it.
        if data.endswith("\n"):
            self._buffer = ""
            return [ln for ln in data.splitlines() if ln]
        parts = data.split("\n")
        self._buffer = parts[-1]
        return [ln for ln in parts[:-1] if ln]

    def final_flush(self) -> list[str]:
        """Return any buffered partial line and clear the buffer.

        Called by ``_poll_progress`` after the subprocess has exited and
        the poll retries have finished. If the child was killed
        mid-write, its last bytes live here as a best-effort tail; the
        caller decides whether to forward them (they probably fail JSON
        parsing, but at least they land in logs).
        """
        if not self._buffer:
            return []
        tail = self._buffer
        self._buffer = ""
        return [tail]

    def close(self) -> None:
        """Release the file handle. Safe to call multiple times."""
        if self._file is not None:
            with contextlib.suppress(Exception):
                self._file.close()
            self._file = None


def _poll_progress(
    proc: subprocess.Popen[bytes],
    progress_path: str,
    job_id: str,
    broadcaster: ProgressBroadcaster | None,
    *,
    job_store: JobStore | None = None,
) -> None:
    """Poll the progress JSONL file and forward to broadcaster.

    When *job_store* is provided (H-0062 Bugfix 2026-04-14 (5)), the
    loop also polls ``job_store.is_cancel_requested(job_id)`` on each
    iteration and terminates the subprocess when cancel is requested.
    Without this escape hatch, a hung child process kept the daemon
    worker thread alive forever and the next retune attempt permanently
    failed with ``PreviousJobStillRunningError``.

    Issue #87: uses an incremental ``_ProgressReader`` instead of
    re-reading the entire file each tick. See that class's docstring
    for the rationale; the behavioural contract here is unchanged —
    only the cost model is.
    """
    reader = _ProgressReader(progress_path)
    terminated = False

    try:
        while proc.poll() is None:
            for line in reader.read_new_lines():
                _forward_progress(line, job_id, broadcaster)
            if (
                not terminated
                and job_store is not None
                and job_store.is_cancel_requested(job_id)
            ):
                _logger.info(
                    "cancel requested for job %s; terminating subprocess", job_id
                )
                terminated = True
                with contextlib.suppress(Exception):
                    proc.terminate()
                # Give the child a brief moment to flush then escalate
                # if still alive. The outer run_job_in_subprocess does
                # the real proc.wait() with _WAIT_TIMEOUT, so here we
                # just break out of the polling loop.
                break
            time.sleep(_POLL_INTERVAL)

        # Final flush — the child has exited (or we terminated it).
        # Retry a handful of times to cover the NFS / overlay2 visibility
        # gap where the kernel flushed the bytes but the parent's view
        # has not caught up yet. Each iteration reads whatever new lines
        # are now visible; if nothing arrives in a full retry cycle we
        # give up and forward the buffered partial as best-effort.
        for _ in range(_FINAL_FLUSH_RETRIES):
            time.sleep(_FINAL_FLUSH_INTERVAL)
            new_lines = reader.read_new_lines()
            if not new_lines:
                continue
            for line in new_lines:
                _forward_progress(line, job_id, broadcaster)

        # Anything still buffered is an incomplete last write — forward
        # it so the information at least reaches _forward_progress's
        # logging path, even if it fails JSON parsing.
        for line in reader.final_flush():
            _forward_progress(line, job_id, broadcaster)
    finally:
        reader.close()


def _forward_progress(
    line: str,
    job_id: str,
    broadcaster: ProgressBroadcaster | None,
) -> None:
    """Parse a JSONL line and forward to broadcaster."""
    if broadcaster is None or not line.strip():
        return
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        return

    msg_type = msg.get("type", "")
    if msg_type == "progress":
        kwargs: dict[str, Any] = {
            "current": msg.get("current", 0),
            "total": msg.get("total", 0),
            "message": msg.get("message", ""),
        }
        fold_results = msg.get("fold_results")
        if fold_results is not None:
            kwargs["fold_results"] = fold_results
        trial_results = msg.get("trial_results")
        if trial_results is not None:
            kwargs["trial_results"] = trial_results
        broadcaster.send_progress(job_id, **kwargs)
    elif msg_type == "completed":
        broadcaster.send_completed(job_id)
    elif msg_type == "error":
        broadcaster.send_error(
            job_id,
            msg.get("message", "Unknown error"),
            code=msg.get("code", "BACKEND_ERROR"),
        )
    elif msg_type == "paused":
        # P-0099 v3-20e: forward the child's paused notification to
        # live WS subscribers via the parent's ProgressBroadcaster.
        broadcaster.send_paused(
            job_id,
            trial_number=msg.get("trial_number"),
            message=msg.get("message", "Paused."),
        )


# --- Child process entry point ---


def _install_sigterm_handler() -> None:
    """Convert SIGTERM into KeyboardInterrupt on the main thread (#153).

    Python's default SIGTERM handler calls ``_exit`` which bypasses
    every Python-level ``finally`` block. That caused
    ``_run_job_core.finally`` to skip — no ``execution.log`` write,
    no ``release_active``, no terminal metric — whenever the parent
    escalated a cancel to SIGTERM.

    This handler uses ``_thread.interrupt_main()`` to raise
    ``KeyboardInterrupt`` on the main thread, which takes the
    ``except (CancelledError, KeyboardInterrupt)`` branch in
    ``_run_job_core`` and runs the existing ``finally``.

    Single-shot (INV-8): the handler resets itself to ``SIG_DFL``
    on entry so a second SIGTERM falls through to the OS default —
    this keeps the parent's ``proc.kill()`` / SIGKILL escalation
    intact for a truly hung child.
    """
    import _thread
    import signal as _signal

    fired = {"once": False}

    def _handler(signum: int, frame: Any) -> None:  # noqa: ARG001
        if fired["once"]:
            # Second SIGTERM: escalate to default action so the parent's
            # proc.kill() / SIGKILL path still terminates a hung child.
            # Only re-raise the signal if the SIG_DFL swap succeeded —
            # otherwise os.kill would re-enter this very handler
            # because the custom slot is still active, creating a
            # signal loop.
            try:
                _signal.signal(_signal.SIGTERM, _signal.SIG_DFL)
            except Exception:
                # SIG_DFL install failed (extremely unlikely on POSIX).
                # Leave the second escalation to the parent's proc.kill
                # SIGKILL path rather than risk an infinite re-entry.
                return
            os.kill(os.getpid(), _signal.SIGTERM)
            return
        fired["once"] = True
        # First SIGTERM: inject KeyboardInterrupt on the main thread
        # so _run_job_core.finally runs.
        _thread.interrupt_main()

    with contextlib.suppress(Exception):
        _signal.signal(_signal.SIGTERM, _handler)


def _child_main(args_path: str, progress_path: str) -> None:
    """Entry point for the child process."""
    # Issue #153: install SIGTERM → KeyboardInterrupt before doing any
    # real work so a parent-triggered SIGTERM during setup still runs
    # the _run_job_core finally block.
    _install_sigterm_handler()

    with open(args_path, encoding="utf-8") as f:
        args = json.load(f)

    job_id: str = args["job_id"]
    jobs_dir = Path(args["jobs_dir"])
    backend_name: str = args["backend_name"]
    config: dict[str, Any] = args["config"]
    data_path: str = args["data_path"]
    job_type: str = args["job_type"]
    mode: str = args.get("mode", "job")

    # Reconstruct dependencies in subprocess
    from lizystudio.backends.registry import get_adapter
    from lizystudio.services.data import load_dataframe

    job_store = JobStore(jobs_dir)
    job = job_store.get(job_id)
    if job is None:
        _write_progress(
            progress_path,
            {"type": "error", "message": f"Job {job_id} not found"},
        )
        sys.exit(1)

    adapter = get_adapter(backend_name)
    dataframe = load_dataframe(data_path)

    # Build a broadcaster-like wrapper that writes to progress file
    file_broadcaster = _FileBroadcaster(progress_path)

    from lizystudio.services.training import run_fit, run_retune, run_tune

    # _FileBroadcaster is duck-type compatible with ProgressBroadcaster
    broadcaster_any: Any = file_broadcaster

    if mode == "retune":
        parent_job_id = args["parent_job_id"]
        parent = job_store.get(parent_job_id)
        if parent is None:
            _write_progress(
                progress_path,
                {"type": "error", "message": f"Parent job {parent_job_id} not found"},
            )
            sys.exit(1)
        run_retune(
            parent_job=parent,
            child_job=job,
            job_store=job_store,
            backend=adapter,
            dataframe=dataframe,
            n_trials=int(args["retune_n_trials"]),
            expand_boundary=args.get("retune_expand_boundary"),
            boundary_threshold=args.get("retune_boundary_threshold"),
            broadcaster=broadcaster_any,
        )
    elif job_type == "fit":
        run_fit(
            job=job,
            job_store=job_store,
            backend=adapter,
            config=config,
            dataframe=dataframe,
            broadcaster=broadcaster_any,
        )
    elif job_type == "tune":
        run_tune(
            job=job,
            job_store=job_store,
            backend=adapter,
            config=config,
            dataframe=dataframe,
            broadcaster=broadcaster_any,
        )
    else:
        _write_progress(
            progress_path,
            {"type": "error", "message": f"Unknown job_type: {job_type}"},
        )
        sys.exit(1)


class _FileBroadcaster:
    """A ProgressBroadcaster substitute that writes JSONL to a file.

    Implements the same interface as ProgressBroadcaster so it can be
    passed to ``run_fit`` / ``run_tune`` via the ``broadcaster`` kwarg.
    """

    def __init__(self, progress_path: str) -> None:
        self._path = progress_path

    def send_progress(
        self,
        job_id: str,
        *,
        current: int,
        total: int,
        message: str,
        fold_results: list[dict[str, Any]] | None = None,
        trial_results: list[dict[str, Any]] | None = None,
    ) -> None:
        msg: dict[str, Any] = {
            "type": "progress",
            "current": current,
            "total": total,
            "message": message,
        }
        if fold_results is not None:
            msg["fold_results"] = fold_results
        if trial_results is not None:
            msg["trial_results"] = trial_results
        _write_progress(self._path, msg)

    def send_completed(self, job_id: str, message: str = "Completed.") -> None:
        _write_progress(
            self._path,
            {"type": "completed", "message": message},
        )

    def send_error(
        self,
        job_id: str,
        message: str,
        code: str = "BACKEND_ERROR",
    ) -> None:
        _write_progress(
            self._path,
            {"type": "error", "message": message, "code": code},
        )

    def send_paused(
        self,
        job_id: str,
        *,
        trial_number: int | None = None,
        message: str = "Paused.",
    ) -> None:
        """P-0099 v3-20e: WsPaused written to the JSONL stream.

        The parent's ``_drain_progress_pipe`` re-reads the JSONL file
        and forwards ``paused`` messages to the live broadcaster, which
        in turn dispatches them to subscribed WS clients. Without this
        method the subprocess child crashes with AttributeError when
        ``_run_job_core`` catches ``PausedError`` and tries to notify.
        """
        msg: dict[str, Any] = {
            "type": "paused",
            "message": message,
        }
        if trial_number is not None:
            msg["trial_number"] = trial_number
        _write_progress(self._path, msg)


def _write_progress(path: str, msg: dict[str, Any]) -> None:
    """Append a JSON line to the progress file (fsync for atomicity)."""
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(msg) + "\n")
        f.flush()
        os.fsync(f.fileno())


if __name__ == "__main__":
    if len(sys.argv) != 3:  # noqa: PLR2004
        print(
            f"Usage: {sys.argv[0]} <args.json> <progress.jsonl>",
            file=sys.stderr,
        )
        sys.exit(1)
    _child_main(sys.argv[1], sys.argv[2])
