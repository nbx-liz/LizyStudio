"""Cooperative-cancel + pause request flags (#451).

Extracted from ``JobStore``. Each of the two concerns (cancel — H-0011 /
Issue #152; pause — P-0099 v3-20c / R-1.4) is represented by an in-memory
``set[str]`` guarded by its own lock and mirrored to an on-disk flag file
(``<job_dir>/CANCEL`` / ``<job_dir>/PAUSE``).

The in-memory set is the **source of truth** for same-process callers.
The file is an IPC channel only: a subprocess child constructs its own
fresh ``JobStore`` (whose in-memory sets are disjoint from the parent's),
so the on-disk flag is how it observes the parent's request at the
cancel-aware callback boundary in ``services/training.py``.

The two pairs are kept independent (separate sets + locks): a job can be
both cancel- and pause-requested in flight, and the callback raises
whichever check fires first while the un-observed flag must persist for
the next call.
"""

from __future__ import annotations

import contextlib
import logging
import os
import threading
from pathlib import Path

from lizystudio.services._job_metadata import JobMetadataStore

_logger = logging.getLogger(__name__)


class JobControlFlags:
    """Cancel + pause request flags for jobs. Thread-safe.

    Holds a :class:`JobMetadataStore` ref solely for path resolution
    (``jobs_dir`` for the staging tempfile, ``path_for`` for the flag
    files — both apply the traversal guard).
    """

    def __init__(self, metadata: JobMetadataStore) -> None:
        self._metadata = metadata
        self._cancel_requested: set[str] = set()
        self._cancel_lock = threading.Lock()
        # P-0099 v3-20c: pause primitives mirror cancel exactly — same
        # in-memory set + lock + on-disk flag IPC pattern. Kept as a
        # separate set so cancel and pause observations stay independent
        # in the cancel-aware callback (a job can be both cancel- and
        # pause-requested in flight; the callback raises whichever check
        # fires first, but the un-observed flag must persist for the
        # next call).
        self._pause_requested: set[str] = set()
        self._pause_lock = threading.Lock()

    # --- cancel (H-0011 / Issue #152) ---

    def request_cancel(self, job_id: str) -> None:
        """Mark a job for cancellation (H-0011).

        Issue #152: also writes ``<job_dir>/CANCEL`` atomically so a
        fresh ``JobStore`` constructed in a subprocess child (whose
        in-memory ``_cancel_requested`` set is disjoint) can observe
        the cancel through ``is_cancel_requested``. The in-memory
        set remains the source of truth for same-process callers;
        the file is an IPC channel only.
        """
        with self._cancel_lock:
            self._cancel_requested.add(job_id)
        # Best-effort file write. Only write if the job_dir already
        # exists — do NOT mkdir it, because that would race with a
        # concurrent delete() of the same job (re-creating the dir
        # while rmtree enumerates it). The in-memory flag remains the
        # source of truth for same-process callers; the file is only
        # needed for subprocess children, which always run after the
        # job_dir was persisted.
        #
        # Place the staging tempfile in jobs_dir (the parent, never
        # deleted by delete(job_id)) rather than the job_dir itself,
        # so a concurrent shutil.rmtree never observes a partially
        # written or intermittent .tmp entry under the victim
        # directory — that was the root cause of a FileNotFoundError
        # surfaced in the concurrent cancel + delete test on 3.11.
        tmp_path: Path | None = None
        try:
            flag_path = self._cancel_flag_path(job_id)
            if not flag_path.parent.exists():
                return
            tmp_path = self._metadata.jobs_dir / f".cancel-{job_id}-{os.getpid()}.tmp"
            tmp_path.write_bytes(b"")
            os.replace(tmp_path, flag_path)
        except (OSError, ValueError):
            # OSError: concurrent delete race / filesystem issue.
            # ValueError: malformed job_id rejected by validate_path_within.
            # Clean up any orphaned tmp file so a failed replace does
            # not leak under jobs_dir.
            if tmp_path is not None:
                with contextlib.suppress(OSError):
                    tmp_path.unlink(missing_ok=True)
            _logger.warning(
                "Failed to write cancel flag for job %s", job_id, exc_info=True
            )

    def is_cancel_requested(self, job_id: str) -> bool:
        """Check whether cancellation was requested for a job.

        Checks the in-memory set first (cheap, hot-path friendly for
        cooperative cancel callbacks). Falls back to the on-disk flag
        file so a child subprocess with a fresh ``JobStore`` still
        observes the parent's cancel (Issue #152).
        """
        with self._cancel_lock:
            if job_id in self._cancel_requested:
                return True
        # Fallback: check the file flag. OSError (e.g. permissions)
        # or ValueError (malformed job_id rejected by
        # validate_path_within) conservatively return False — the
        # parent's in-process wait loop will eventually escalate to
        # SIGTERM anyway. Critically, this method is called from the
        # hot cooperative-cancel loop in training.py, so it MUST NOT
        # propagate exceptions.
        try:
            return self._cancel_flag_path(job_id).exists()
        except (OSError, ValueError):
            return False

    def clear_cancel(self, job_id: str) -> None:
        """Clear cancellation flag after processing."""
        with self._cancel_lock:
            self._cancel_requested.discard(job_id)
        try:
            self._cancel_flag_path(job_id).unlink(missing_ok=True)
        except (OSError, ValueError):
            _logger.warning(
                "Failed to clear cancel flag for job %s", job_id, exc_info=True
            )

    def _cancel_flag_path(self, job_id: str) -> Path:
        """Resolve the cancel flag path with the traversal guard.

        Thin wrapper over ``JobMetadataStore.path_for`` so a malformed
        job_id cannot escape the jobs_dir root.
        """
        return self._metadata.path_for(job_id, "cancel_flag")

    # --- pause / unpause (P-0099 v3-20c, R-1.4) ---

    def request_pause(self, job_id: str) -> None:
        """Mark a job for pause (R-1.4 / Issue #360).

        Mirrors :meth:`request_cancel`: the in-memory set is the source
        of truth for same-process callers, and ``<job_dir>/PAUSE`` is the
        IPC channel a subprocess child reads through its own fresh
        :class:`JobStore`. The cancel-aware callback raises
        ``PausedError`` instead of ``CancelledError`` when this
        observation fires, and ``_run_job_core`` catches it on a branch
        that KEEPS ``active_job_id`` so the same job id can be resumed
        in place (slot ownership extension to INV-1).
        """
        with self._pause_lock:
            self._pause_requested.add(job_id)
        # Best-effort file write. Same job_dir-must-exist guard and
        # tmp-in-jobs_dir staging as request_cancel — see that method's
        # comment for the concurrent-delete-race rationale.
        tmp_path: Path | None = None
        try:
            flag_path = self._pause_flag_path(job_id)
            if not flag_path.parent.exists():
                return
            tmp_path = self._metadata.jobs_dir / f".pause-{job_id}-{os.getpid()}.tmp"
            tmp_path.write_bytes(b"")
            os.replace(tmp_path, flag_path)
        except (OSError, ValueError):
            if tmp_path is not None:
                with contextlib.suppress(OSError):
                    tmp_path.unlink(missing_ok=True)
            _logger.warning(
                "Failed to write pause flag for job %s", job_id, exc_info=True
            )

    def is_pause_requested(self, job_id: str) -> bool:
        """Check whether a pause request has been observed.

        In-memory check first (hot cancel-aware-callback path), then
        on-disk flag fallback for subprocess children.  Any OSError /
        ValueError fallback returns ``False`` so a malformed job_id or
        permissions glitch cannot stall the worker.
        """
        with self._pause_lock:
            if job_id in self._pause_requested:
                return True
        try:
            return self._pause_flag_path(job_id).exists()
        except (OSError, ValueError):
            return False

    def clear_pause(self, job_id: str) -> None:
        """Clear the pause observation after the worker has unwound.

        The /unpause endpoint calls this immediately before re-launching
        the resume worker so the next callback iteration does not raise
        ``PausedError`` again on the same flag.
        """
        with self._pause_lock:
            self._pause_requested.discard(job_id)
        try:
            self._pause_flag_path(job_id).unlink(missing_ok=True)
        except (OSError, ValueError):
            _logger.warning(
                "Failed to clear pause flag for job %s", job_id, exc_info=True
            )

    def _pause_flag_path(self, job_id: str) -> Path:
        """Resolve the pause flag path with the traversal guard."""
        return self._metadata.path_for(job_id, "pause_flag")
