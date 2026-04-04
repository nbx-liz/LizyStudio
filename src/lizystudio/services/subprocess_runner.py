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

import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from lizystudio.services.jobs import Job, JobStore

if TYPE_CHECKING:
    from lizystudio.ws.progress import ProgressBroadcaster

_logger = logging.getLogger(__name__)

_POLL_INTERVAL = 0.2  # seconds between progress file polls


def run_job_in_subprocess(
    *,
    job: Job,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster | None,
    backend_name: str,
    data_path: str,
) -> Job:
    """Execute a job in a subprocess and return the updated Job.

    Progress is forwarded to *broadcaster* by polling a JSONL file
    written by the child process.
    """
    # Prepare arguments for the child process
    args_dict: dict[str, Any] = {
        "job_id": job.job_id,
        "jobs_dir": str(job_store.jobs_dir),
        "backend_name": backend_name,
        "config": job.config,
        "data_path": data_path,
        "job_type": job.job_type,
    }

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

        _poll_progress(proc, progress_path, job.job_id, broadcaster)
        proc.wait()

        if proc.returncode != 0:
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
    return updated


def _poll_progress(
    proc: subprocess.Popen[bytes],
    progress_path: str,
    job_id: str,
    broadcaster: ProgressBroadcaster | None,
) -> None:
    """Poll the progress JSONL file and forward to broadcaster."""
    lines_read = 0
    path = Path(progress_path)

    while proc.poll() is None:
        if path.exists():
            lines = path.read_text(encoding="utf-8").splitlines()
            for line in lines[lines_read:]:
                lines_read += 1
                _forward_progress(line, job_id, broadcaster)
        time.sleep(_POLL_INTERVAL)

    # Final flush — read any remaining lines after subprocess exits.
    # Retry once to handle partial writes at EOF.
    time.sleep(0.05)
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
        for line in lines[lines_read:]:
            _forward_progress(line, job_id, broadcaster)


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

    from lizystudio.services.training import run_fit, run_tune

    # _FileBroadcaster is duck-type compatible with ProgressBroadcaster
    broadcaster_any: Any = file_broadcaster

    if job_type == "fit":
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
    ) -> None:
        msg: dict[str, Any] = {
            "type": "progress",
            "current": current,
            "total": total,
            "message": message,
        }
        if fold_results is not None:
            msg["fold_results"] = fold_results
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
