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
    """
    # Prepare arguments for the child process
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

    try:
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "lizystudio.services.subprocess_runner",
                args_path,
                progress_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
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

        if proc.returncode not in (0, None):
            raw = proc.stderr.read() if proc.stderr else b""
            stderr = (raw or b"").decode(errors="replace")
            _logger.error(
                "Subprocess exited with code %d: %s",
                proc.returncode,
                stderr[:500],
            )
    finally:
        Path(args_path).unlink(missing_ok=True)
        Path(progress_path).unlink(missing_ok=True)

    # Reload job from disk (subprocess persisted the result)
    updated = job_store.get(job.job_id)
    if updated is None:
        # Fallback: mark as failed if subprocess didn't persist
        job.status = "failed"
        job.error = "Subprocess did not persist job result"
        return job

    # If the child was killed mid-run (Cancel -> SIGTERM, or hard kill
    # after _WAIT_TIMEOUT), it never reached ``_run_job_core.finally``
    # and so never wrote a terminal state back to disk. Reconcile here
    # based on the cancel flag so waiters downstream (E2E, UI) see the
    # final status instead of spinning on ``running`` forever.
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
                f"Subprocess exited with code {proc.returncode} "
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


# --- Child process entry point ---


def _child_main(args_path: str, progress_path: str) -> None:
    """Entry point for the child process."""
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
