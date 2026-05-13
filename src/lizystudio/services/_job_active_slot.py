"""Active-job slot — the at-most-one-running concurrency control (#451).

Extracted from ``JobStore`` so the concurrency concern is isolated from
disk CRUD, cancel/pause flags and lineage.

INV-1: ``active_job_id`` holds **at most one** running-or-paused job at
any time, released on every termination path (completion / cancel /
exception / SIGKILL / WebSocket disconnect / browser close) — ``paused``
is the deliberate exception that retains the slot so a concurrent
``/tune`` is rejected with ``JOB_CONFLICT`` until ``/unpause`` (the
in-place resume contract, v3-20d).

The slot holds a reference to ``JobMetadataStore`` solely to read the
current holder's status when deciding whether the slot is *stale* (held
by a job that is actually terminal — happens after a subprocess kill
skipped the release, or a restart re-seeded the slot), and a reference
to the per-app ``MetricsRegistry`` solely to keep the ``active_jobs``
gauge in sync. Everything else — the lock, the slot id, the
claim/release/reclaim logic — is self-contained.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import TYPE_CHECKING, Any, Literal

from lizystudio.backends.types import DataRef
from lizystudio.services._job_metadata import Job, JobMetadataStore

if TYPE_CHECKING:
    from lizystudio.metrics import MetricsRegistry

_logger = logging.getLogger(__name__)


class ActiveJobSlot:
    """At-most-one running-or-paused job (INV-1). Thread-safe."""

    def __init__(
        self,
        metadata: JobMetadataStore,
        metrics: MetricsRegistry | None = None,
    ) -> None:
        self._metadata = metadata
        # A-9: the active-slot gauge lives on the per-app MetricsRegistry.
        # ``metrics`` is None in the subprocess child path where the
        # child's Prometheus state is isolated from the parent (the
        # parent's registry is the one that gets scraped), so bumping a
        # disconnected gauge inside the child is a no-op we simply skip.
        self._metrics = metrics
        self._active_job_id: str | None = None
        self._lock = threading.Lock()

    # --- gauge ---

    def _set_gauge(self, value: float) -> None:
        """Update the ``active_jobs`` gauge on the bound MetricsRegistry."""
        if self._metrics is not None:
            self._metrics.active_jobs.set(value)

    # --- staleness probe ---

    def _is_holder_stale_locked(self) -> bool:
        """Return True when the current slot holder is in a terminal state.

        Caller must hold ``self._lock``. A holder whose ``meta.json`` is
        gone or unreadable is treated as stale (definitely not running).
        """
        holder = self._active_job_id
        if holder is None:
            return False
        try:
            job = self._metadata.load_job(holder)
        except (FileNotFoundError, OSError, json.JSONDecodeError, KeyError):
            return True
        return job.status in ("completed", "failed", "cancelled")

    # --- claim / release ---

    def create_and_claim(
        self,
        *,
        backend_name: str,
        config: dict[str, Any],
        data_ref: DataRef,
        job_type: Literal["fit", "tune"],
        parent_job_id: str | None = None,
    ) -> Job | None:
        """Atomically create a pending job and claim the slot.

        Returns the newly created ``Job`` when the slot was empty, or
        ``None`` when another (non-stale) job already owns it. Unlike a
        two-step ``create(...) + claim(...)`` this never persists an
        orphan ``failed`` directory for the losing caller — nothing is
        written until the slot is actually held.

        ``_run_job_core`` later re-invokes :meth:`claim` with the same
        ``job_id`` — that call is a no-op because the slot is already
        owned by this job.

        Before refusing a request the current holder is checked for
        staleness (terminal ``completed`` / ``failed`` / ``cancelled``
        rows have no business occupying the slot — can happen if a
        subprocess path returned without going through
        ``_run_job_core.finally``, the server restarted mid-job, or a
        cancel left the runner unable to reach the release call). Rather
        than locking the workspace out permanently, the slot is reclaimed
        from the stale owner so the next fit/tune can proceed. The stale
        job's on-disk state is left untouched.
        """
        with self._lock:
            if self._active_job_id is not None:
                if not self._is_holder_stale_locked():
                    return None
                _logger.warning(
                    "Active slot held by stale job %s; reclaiming",
                    self._active_job_id,
                )
                self._active_job_id = None
            job = self._metadata.create(
                backend_name=backend_name,
                config=config,
                data_ref=data_ref,
                job_type=job_type,
                parent_job_id=parent_job_id,
            )
            self._active_job_id = job.job_id
            self._set_gauge(1)
            return job

    def claim(self, job_id: str) -> bool:
        """Attempt to claim the slot.

        Returns ``True`` when the slot is empty *or* already held by
        ``job_id`` (idempotent re-claim — the runner thread re-enters
        with the same id to keep ownership explicit). Returns ``False``
        when a different job currently owns it.
        """
        with self._lock:
            if self._active_job_id is None:
                self._active_job_id = job_id
                self._set_gauge(1)
                return True
            # H-0065: the re-claim branch intentionally skips the gauge
            # update — the gauge was already set to 1 by the original
            # ``create_and_claim`` / ``claim`` that acquired the slot,
            # and bumping it again would be a no-op.
            return self._active_job_id == job_id

    def release(self, job_id: str) -> None:
        """Release the slot iff it is held by ``job_id``."""
        with self._lock:
            if self._active_job_id == job_id:
                self._active_job_id = None
                self._set_gauge(0)

    def force_release_if(self, expected_job_id: str) -> bool:
        """Atomically release the slot iff still held by *expected_job_id*.

        H-0063: ``workspace_reset`` uses this to force-release a stuck
        orphan slot after its cancel wait times out. The naive read +
        ``release(active_id)`` dance is racy — between the read and the
        release another thread could claim the slot with a new id and
        the caller would release someone else's slot. Keeping the
        compare and release under one critical section makes this either
        release the exact id the caller observed or be a no-op.

        Returns True if the slot was released, False otherwise.
        """
        with self._lock:
            if self._active_job_id == expected_job_id:
                self._active_job_id = None
                self._set_gauge(0)
                return True
            return False

    def has_active(self) -> bool:
        """True when a job currently owns the slot."""
        with self._lock:
            return self._active_job_id is not None

    @property
    def active_job_id(self) -> str | None:
        """The currently active job ID, or ``None``."""
        with self._lock:
            return self._active_job_id

    def reattach(self, job_id: str) -> None:
        """Force the slot onto *job_id* — startup reconciliation only.

        Used by ``JobStore.reconcile_at_startup`` to restore a paused
        survivor's slot after a restart. Unlike :meth:`claim` this does
        not consult the current holder: at fresh process start the
        in-memory slot is always ``None``, and the disk meta drives the
        re-attach decision (INV-restart-2).
        """
        with self._lock:
            self._active_job_id = job_id
            self._set_gauge(1)
