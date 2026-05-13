"""Job persistence — orchestrates the on-disk job store (BLUEPRINT §3.4.2/§3.4.4).

The disk-CRUD half (the ``Job`` dataclass, the §3.4.4 layout, and
``meta.json`` / ``fit_result.json`` / ``tune_result.json`` round-trips)
lives in :mod:`lizystudio.services._job_metadata`. ``JobStore`` wires
that ``JobMetadataStore`` together with the concurrency (active slot),
cancel/pause-flag and lineage concerns and the owned model cache. The
metadata symbols are re-exported here for backward compatibility with
``from lizystudio.services.jobs import Job, artifact_path, ...``.
"""

from __future__ import annotations

import builtins
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from fastapi import Request

from lizystudio.backends.types import DataRef
from lizystudio.services._job_active_slot import ActiveJobSlot
from lizystudio.services._job_control_flags import JobControlFlags
from lizystudio.services._job_lineage import JobLineage

# Most of these are pure re-exports kept in ``__all__`` so existing
# import sites (``from lizystudio.services.jobs import Job / artifact_path
# / CANCEL_FLAG_FILENAME / ...``) keep working after the #451 split.
from lizystudio.services._job_metadata import (
    ARTIFACT_FILENAMES,
    CANCEL_FLAG_FILENAME,
    PAUSE_FLAG_FILENAME,
    ArtifactKind,
    Job,
    JobMetadataStore,
    artifact_path,
    read_job_json,
)

if TYPE_CHECKING:
    from lizystudio.backends.base import BackendAdapter
    from lizystudio.metrics import JobType, MetricsRegistry, TerminalStatus

_logger = logging.getLogger(__name__)


class JobStore:
    """Disk-backed job store — the orchestrator over four focused collaborators.

    Layout per BLUEPRINT §3.4.4::

        {jobs_dir}/{job_id}/meta.json
        {jobs_dir}/{job_id}/fit_result.json
        {jobs_dir}/{job_id}/tune_result.json
        {jobs_dir}/{job_id}/model/

    #451 decomposition — ``JobStore`` keeps the public Protocol shape so
    api/services callers do not change, but the mechanism lives in:

    - :class:`~lizystudio.services._job_metadata.JobMetadataStore` —
      path resolution + ``create`` / ``get`` / ``list`` / ``update`` /
      ``get_log`` + the versioned-JSON round-trip (C-9 / H-0081);
    - :class:`~lizystudio.services._job_active_slot.ActiveJobSlot` —
      the at-most-one-running concurrency control (INV-1) + the
      ``active_jobs`` gauge;
    - :class:`~lizystudio.services._job_control_flags.JobControlFlags` —
      cooperative-cancel + pause request flags (in-mem set + on-disk IPC);
    - :class:`~lizystudio.services._job_lineage.JobLineage` —
      Re-tune/Resume parent/child graph + per-parent retune lock (H-0062).

    ``JobStore`` itself owns: the H-0084 model cache, the metrics
    registry forwarding (``record_job_terminal``), and the cross-concern
    orchestration that genuinely spans collaborators — ``delete`` (cascade
    BFS + dir removal + cache eviction), ``reconcile_at_startup`` (orphan
    fail + paused-survivor re-attach), ``set_status`` (the INV-3 state-
    machine guard around a meta write).
    """

    def __init__(
        self,
        jobs_dir: Path,
        metrics: MetricsRegistry | None = None,
    ) -> None:
        # The collaborators (see the class docstring). ``self.jobs_dir`` is
        # kept (aliasing the metadata store's) for call sites that read it.
        self._meta = JobMetadataStore(jobs_dir)
        self.jobs_dir = self._meta.jobs_dir
        self._slot = ActiveJobSlot(self._meta, metrics)
        self._flags = JobControlFlags(self._meta)
        self._lineage = JobLineage(self._meta)
        # A-9: metrics registry threaded through here for the terminal-
        # transition counters (``record_job_terminal``). The active-slot
        # gauge lives inside ``ActiveJobSlot``; ``None`` in the subprocess
        # child where Prometheus output is never scraped.
        self._metrics = metrics
        # H-0084 (Issue #235): model cache lives on the JobStore so two
        # app instances sharing a process keep their caches isolated.
        # Imported lazily to avoid a top-level cycle with job_results.
        from lizystudio.services.job_results import ModelCache

        self.model_cache: ModelCache = ModelCache()

    def load_model(self, job: Job, backend: BackendAdapter) -> Any:
        """Load a trained model, memoised via the owned ``ModelCache``
        (H-0084)."""
        return self.model_cache.load(job, backend)

    def clear_model_cache(self) -> None:
        """Drop all memoised models (H-0084)."""
        self.model_cache.clear()

    def clear_model_cache_for(self, model_path: str) -> None:
        """Drop memoised entries for a specific model path (H-0084)."""
        self.model_cache.clear_for(model_path)

    def record_job_terminal(
        self,
        job_type: JobType,
        status: TerminalStatus,
        duration: float = 0.0,
    ) -> None:
        """Forward a terminal transition to the bound :class:`MetricsRegistry`.

        A-9: the training service layer already threads a ``JobStore``
        through every call path, so re-using it as the metrics entry
        point avoids duplicating the plumbing. A ``None`` registry is
        a no-op (used by the subprocess child where Prometheus output
        is never scraped).
        """
        if self._metrics is None:
            return
        self._metrics.record_job_terminal(job_type, status, duration=duration)

    # --- Path resolution (A-10) — delegated to JobMetadataStore (#451) ---

    def job_dir(self, job_id: str) -> Path:
        """Resolve the job directory (traversal-guarded).

        See :meth:`JobMetadataStore.job_dir`."""
        return self._meta.job_dir(job_id)

    def path_for(self, job_id: str, kind: ArtifactKind) -> Path:
        """Resolve a named job artifact path. See :meth:`JobMetadataStore.path_for`."""
        return self._meta.path_for(job_id, kind)

    # --- CRUD — delegated to JobMetadataStore (#451) ---

    def create(
        self,
        *,
        backend_name: str,
        config: dict[str, Any],
        data_ref: DataRef,
        job_type: Literal["fit", "tune"],
        parent_job_id: str | None = None,
    ) -> Job:
        """Create a new pending job (records lineage when *parent_job_id*
        is given, H-0062). See :meth:`JobMetadataStore.create`."""
        return self._meta.create(
            backend_name=backend_name,
            config=config,
            data_ref=data_ref,
            job_type=job_type,
            parent_job_id=parent_job_id,
        )

    def get(self, job_id: str) -> Job | None:
        """Load a job by ID, or ``None``. See :meth:`JobMetadataStore.get`."""
        return self._meta.get(job_id)

    def list(
        self,
        *,
        status: str | None = None,
        sort: str = "created_at",
    ) -> builtins.list[Job]:
        """List jobs (filtered/sorted). See :meth:`JobMetadataStore.list`."""
        return self._meta.list(status=status, sort=sort)

    def update(self, job: Job) -> None:
        """Persist job state (meta + result sidecars). See
        :meth:`JobMetadataStore.update`."""
        self._meta.update(job)

    def delete(self, job_id: str, *, cascade: bool = False) -> builtins.list[str]:
        """Delete a job directory. Returns the list of removed job IDs.

        Cross-concern orchestration: walks the lineage subtree
        (``JobLineage``), removes the directories (``JobMetadataStore``
        layout) and evicts cached models (``ModelCache``).

        When *cascade* is True (H-0062), the entire descendant subtree is
        removed recursively.  When False only the requested job is
        removed (existing children become orphaned).  An empty list is
        returned when the job does not exist.
        """
        if not self._meta.job_dir(job_id).exists():
            return []

        removed: builtins.list[str] = []
        if cascade:
            # Iterative BFS to collect all descendants first so we never
            # rmtree a directory while we still need to enumerate its
            # siblings.
            queue: builtins.list[str] = [job_id]
            while queue:
                current = queue.pop()
                removed.append(current)
                queue.extend(self._lineage.get_child_job_ids(current))
        else:
            removed.append(job_id)

        for jid in removed:
            target = self._meta.job_dir(jid)
            if target.exists():
                # ignore_errors: a concurrent request_cancel (#152) can
                # briefly stage a tempfile inside the victim tree, and
                # rmtree's listdir → unlink cycle sees the stale entry
                # and raises FileNotFoundError. The file is about to be
                # deleted anyway; swallow the transient error instead
                # of propagating it out of delete().
                shutil.rmtree(target, ignore_errors=True)
            # Drop any cached deserialised model for this job (H-0084).
            self.model_cache.clear_for(str(self._meta.path_for(jid, "model")))
        return removed

    # --- H-0062 lineage + per-parent retune lock — delegated to JobLineage (#451) ---

    def get_child_job_ids(self, parent_job_id: str) -> builtins.list[str]:
        """Return direct children of *parent_job_id* (H-0062). See
        :meth:`JobLineage.get_child_job_ids`."""
        return self._lineage.get_child_job_ids(parent_job_id)

    def get_lineage_tree(self, root_job_id: str) -> dict[str, Any] | None:
        """Return ``{job_id, status, children: [...]}`` rooted at *root_job_id*
        (depth-guarded). See :meth:`JobLineage.get_lineage_tree`."""
        return self._lineage.get_lineage_tree(root_job_id)

    def has_active_children(self, parent_job_id: str) -> bool:
        """True when any direct child is pending/running/paused (H-0062,
        P-0099 v3-20c). See :meth:`JobLineage.has_active_children`."""
        return self._lineage.has_active_children(parent_job_id)

    def acquire_parent_lock(self, parent_job_id: str, child_job_id: str) -> bool:
        """Try to claim the Re-tune/Resume slot for *parent_job_id* (H-0062).
        See :meth:`JobLineage.acquire_parent_lock`."""
        return self._lineage.acquire_parent_lock(parent_job_id, child_job_id)

    def release_parent_lock(self, parent_job_id: str) -> None:
        """Release the Re-tune/Resume slot for *parent_job_id* if held. See
        :meth:`JobLineage.release_parent_lock`."""
        self._lineage.release_parent_lock(parent_job_id)

    def rebind_parent_lock(
        self, parent_job_id: str, expected_holder: str, new_holder: str
    ) -> bool:
        """Atomically swap the lock holder from *expected_holder* to
        *new_holder* (H-0062 Bugfix). See :meth:`JobLineage.rebind_parent_lock`."""
        return self._lineage.rebind_parent_lock(
            parent_job_id, expected_holder, new_holder
        )

    def get_locked_child(self, parent_job_id: str) -> str | None:
        """Return the child currently holding *parent_job_id*'s lock. See
        :meth:`JobLineage.get_locked_child`."""
        return self._lineage.get_locked_child(parent_job_id)

    # --- Cancel / pause request flags — delegated to JobControlFlags (#451) ---

    def request_cancel(self, job_id: str) -> None:
        """Mark a job for cancellation (H-0011 / Issue #152). See
        :meth:`JobControlFlags.request_cancel`."""
        self._flags.request_cancel(job_id)

    def is_cancel_requested(self, job_id: str) -> bool:
        """Check whether cancellation was requested (hot cooperative-cancel
        path — never raises). See :meth:`JobControlFlags.is_cancel_requested`."""
        return self._flags.is_cancel_requested(job_id)

    def clear_cancel(self, job_id: str) -> None:
        """Clear the cancel flag after processing. See
        :meth:`JobControlFlags.clear_cancel`."""
        self._flags.clear_cancel(job_id)

    def request_pause(self, job_id: str) -> None:
        """Mark a job for pause (R-1.4 / Issue #360 / P-0099 v3-20c). See
        :meth:`JobControlFlags.request_pause`."""
        self._flags.request_pause(job_id)

    def is_pause_requested(self, job_id: str) -> bool:
        """Check whether a pause request has been observed. See
        :meth:`JobControlFlags.is_pause_requested`."""
        return self._flags.is_pause_requested(job_id)

    def clear_pause(self, job_id: str) -> None:
        """Clear the pause flag after the worker has unwound. See
        :meth:`JobControlFlags.clear_pause`."""
        self._flags.clear_pause(job_id)

    # --- INV-3 runtime guard (P-0099 v3-20c) ---

    def set_status(self, job_id: str, new_status: str) -> None:
        """Persist ``new_status`` for *job_id* under the INV-3 guard.

        Asserts ``(current_status, new_status)`` is a member of
        :data:`tests/regression/test_inv_state_machine.py:LEGAL_TRANSITIONS`
        (re-declared inline below to avoid a runtime dependency on the
        test module).  Illegal transitions raise ``AssertionError`` so a
        regression in the API layer cannot silently rewind audit trails
        or skip non-terminal states.

        Direct ``update(job)`` writes still bypass this guard — the
        runtime assertion is opt-in for callers that mutate status at
        the API boundary (e.g. /pause, /unpause).  ``_run_job_core``
        keeps using ``update`` because its except-branches each have a
        single legal pre-state, so an extra assertion would only be
        defensive without changing the executable contract.
        """
        # P-0099 INV-3: pinned in tests/regression/test_inv_state_machine.py
        # under ``LEGAL_TRANSITIONS``. Mirrored here as a frozenset literal
        # so the runtime guard does not import from a test module.
        legal_transitions: frozenset[tuple[str, str]] = frozenset(
            {
                ("pending", "running"),
                ("pending", "cancelled"),
                ("running", "completed"),
                ("running", "failed"),
                ("running", "cancelled"),
                ("running", "paused"),
                ("paused", "running"),
                ("paused", "cancelled"),
                ("paused", "failed"),
            }
        )
        job = self._meta.get(job_id)
        assert job is not None, f"set_status: job {job_id!r} does not exist"
        current = job.status
        assert (current, new_status) in legal_transitions, (
            f"INV-3 violation: illegal transition {current!r} -> {new_status!r} "
            f"for job {job_id!r}"
        )
        # mypy: new_status is a free str on the API surface; the literal
        # widening here is verified by the legal_transitions membership
        # check above, which only contains valid Job.status literals.
        job.status = new_status  # type: ignore[assignment]
        self._meta.update(job)

    # --- Startup reconciliation (P-0099 v3-22a, R-1.5b) ---

    def reconcile_at_startup(self) -> None:
        """Reconcile in-memory state with disk after server (re)start.

        At fresh process start the in-memory ``_active_job_id`` is
        ``None`` while ``meta.json`` files survive the restart. Three
        invariants must be restored:

          INV-restart-1: ``running`` / ``pending`` rows on disk are
            orphaned — no thread / subprocess survived. Reconcile to
            ``failed`` with a clear error so the UI does not dangle.

          INV-restart-2: at most ONE ``paused`` job survives (newest
            by ``created_at`` wins). The survivor claims the active
            slot so a concurrent /tune is rejected with
            ``JOB_CONFLICT`` until the user clicks Resume or Cancel
            (in-place /unpause contract from v3-20d).

          INV-restart-3: terminal rows (completed / failed / cancelled)
            are NEVER rewritten — reconciliation is a one-way forward
            arrow.

        Idempotent: running a second time on already-reconciled state
        is a no-op (paused survivor stays paused, terminals stay
        terminal, no further candidates exist).
        """
        paused_candidates: list[Job] = []
        running_orphans: list[Job] = []
        for job in self._meta.list():
            if job.status in ("running", "pending"):
                running_orphans.append(job)
            elif job.status == "paused":
                paused_candidates.append(job)

        now = datetime.now(timezone.utc).isoformat()

        for job in running_orphans:
            _logger.warning(
                "Reconciling orphaned %s job %s to failed at startup",
                job.status,
                job.job_id,
            )
            job.status = "failed"
            job.error = "Server restarted before this job could complete"
            job.completed_at = now
            self._meta.update(job)

        if len(paused_candidates) > 1:
            paused_candidates.sort(key=lambda j: j.created_at, reverse=True)
            winner = paused_candidates[0]
            _logger.warning(
                "Multiple paused jobs at startup (%d); keeping newest %s, "
                "reconciling the rest to failed",
                len(paused_candidates),
                winner.job_id,
            )
            for job in paused_candidates[1:]:
                job.status = "failed"
                job.error = (
                    "Multiple paused jobs found at startup; only the newest "
                    "is preserved (INV-1: at most one paused job)"
                )
                job.completed_at = now
                self._meta.update(job)
            paused_candidates = [winner]

        if paused_candidates:
            survivor = paused_candidates[0]
            self._slot.reattach(survivor.job_id)
            _logger.info(
                "Re-attached paused job %s to active slot at startup",
                survivor.job_id,
            )

    # --- Active job tracking — delegated to ActiveJobSlot (#451) ---

    def create_and_claim_active(
        self,
        *,
        backend_name: str,
        config: dict[str, Any],
        data_ref: DataRef,
        job_type: Literal["fit", "tune"],
        parent_job_id: str | None = None,
    ) -> Job | None:
        """Atomically create a pending job and claim the active slot.
        See :meth:`ActiveJobSlot.create_and_claim`."""
        return self._slot.create_and_claim(
            backend_name=backend_name,
            config=config,
            data_ref=data_ref,
            job_type=job_type,
            parent_job_id=parent_job_id,
        )

    def claim_active(self, job_id: str) -> bool:
        """Attempt to claim the active slot (idempotent re-claim by the
        same job is a no-op). See :meth:`ActiveJobSlot.claim`."""
        return self._slot.claim(job_id)

    def release_active(self, job_id: str) -> None:
        """Release the active slot iff held by ``job_id``. See
        :meth:`ActiveJobSlot.release`."""
        self._slot.release(job_id)

    def force_release_active_if(self, expected_job_id: str) -> bool:
        """Atomically release the slot iff still held by *expected_job_id*.
        See :meth:`ActiveJobSlot.force_release_if`."""
        return self._slot.force_release_if(expected_job_id)

    def has_active_job(self) -> bool:
        """True when a job currently owns the active slot. See
        :meth:`ActiveJobSlot.has_active`."""
        return self._slot.has_active()

    @property
    def active_job_id(self) -> str | None:
        """The currently active job ID, or ``None``. See
        :attr:`ActiveJobSlot.active_job_id`."""
        return self._slot.active_job_id

    def get_log(self, job_id: str) -> str:
        """Read the execution log for a job; ``""`` when none. See
        :meth:`JobMetadataStore.get_log`."""
        return self._meta.get_log(job_id)


def get_job_store(request: Request) -> JobStore:
    """FastAPI dependency — retrieve job store from app.state."""
    return request.app.state.job_store  # type: ignore[no-any-return]


# --- Back-compat re-exports (A-7: dispatch helpers moved to job_results) ---
# External callers historically import these from services.jobs. The logic
# now lives in services/job_results.py. H-0084: the cache-management
# helpers (clear_model_cache / clear_model_cache_for / load_job_model)
# have been retired in favour of the JobStore-owned ModelCache; use
# ``JobStore.load_model`` / ``JobStore.clear_model_cache`` / the helpers
# below that accept a ``cache`` argument instead.
from lizystudio.services.job_results import (  # noqa: E402
    _get_jobs_dir,
    _load_tuning_plot_from_file,
    get_available_plots,
    get_importance,
    get_importance_kinds,
    get_job_plot,
    get_learning_curve_metrics,
    get_metrics_table,
    get_split_summary,
)

__all__ = [
    "ARTIFACT_FILENAMES",
    "CANCEL_FLAG_FILENAME",
    "PAUSE_FLAG_FILENAME",
    "ArtifactKind",
    "Job",
    "JobMetadataStore",
    "JobStore",
    "_get_jobs_dir",
    "_load_tuning_plot_from_file",
    "artifact_path",
    "get_available_plots",
    "get_importance",
    "get_importance_kinds",
    "get_job_plot",
    "get_job_store",
    "get_learning_curve_metrics",
    "get_metrics_table",
    "get_split_summary",
    "read_job_json",
]
