"""Job persistence — CRUD for fit/tune jobs on disk (BLUEPRINT §3.4.2/§3.4.4)."""

from __future__ import annotations

import builtins
import contextlib
import json
import logging
import os
import shutil
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal
from uuid import uuid4

from fastapi import Request

from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.security import validate_path_within  # noqa: E402
from lizystudio.storage.versions import (  # noqa: E402
    read_versioned_json,
    write_versioned_json,
)

if TYPE_CHECKING:
    from lizystudio.metrics import JobType, MetricsRegistry, TerminalStatus

_logger = logging.getLogger(__name__)


# Issue #152: filename of the on-disk cancel flag. In subprocess mode
# the child constructs a fresh JobStore whose in-memory
# ``_cancel_requested`` set is disjoint from the parent's. The flag
# file is the IPC channel that lets the child observe the parent's
# ``request_cancel`` between trials, so cooperative cancel (H-0011)
# actually fires before the SIGTERM escalation.
CANCEL_FLAG_FILENAME = "CANCEL"


# A-10: BLUEPRINT §3.4.4 on-disk layout for a single job. Centralising
# this map is the core of the path-layout SSOT — every artifact filename
# lives here, and every caller goes through ``JobStore.path_for`` (or
# the module-level :func:`artifact_path` helper, used by call sites
# that have a ``jobs_dir`` but no ``JobStore`` instance).
ArtifactKind = Literal[
    "meta",
    "fit_result",
    "tune_result",
    "model",
    "log",
    "tuning_plot",
    "cancel_flag",
]

ARTIFACT_FILENAMES: dict[ArtifactKind, str] = {
    "meta": "meta.json",
    "fit_result": "fit_result.json",
    "tune_result": "tune_result.json",
    "model": "model",  # directory (see load/save in adapters)
    "log": "execution.log",
    "tuning_plot": "tuning_plot.json",
    "cancel_flag": CANCEL_FLAG_FILENAME,
}


def artifact_path(jobs_dir: Path, job_id: str, kind: ArtifactKind) -> Path:
    """Resolve ``{jobs_dir}/{job_id}/<artifact>`` without a ``JobStore``.

    ``JobStore.path_for`` is the preferred entry point (it also applies
    path-traversal guards). This helper exists for call sites — e.g.
    :mod:`lizystudio.services.job_results` — that hold a ``Job`` and can
    derive ``jobs_dir`` from ``Job.model_path`` but do not own the
    ``JobStore`` instance. Callers are responsible for validating
    ``job_id`` when it is user-controlled.
    """
    return jobs_dir / job_id / ARTIFACT_FILENAMES[kind]


@dataclass
class Job:
    """Persistent job metadata."""

    job_id: str
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    backend_name: str
    config: dict[str, Any]
    data_ref: DataRef
    job_type: Literal["fit", "tune"]
    created_at: str  # ISO-8601
    completed_at: str | None = None
    fit_result: FitSummary | None = None
    tune_result: TuningSummary | None = None
    model_path: str | None = None
    error: str | None = None
    # H-0062: job lineage for Re-tune / Resume child jobs. Optional so
    # existing jobs on disk (written before Phase B) continue to load.
    parent_job_id: str | None = None


class JobStore:
    """Disk-backed job store.

    Layout per BLUEPRINT §3.4.4::

        {jobs_dir}/{job_id}/meta.json
        {jobs_dir}/{job_id}/fit_result.json
        {jobs_dir}/{job_id}/tune_result.json
        {jobs_dir}/{job_id}/model/
    """

    def __init__(
        self,
        jobs_dir: Path,
        metrics: MetricsRegistry | None = None,
    ) -> None:
        self.jobs_dir = jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._cancel_requested: set[str] = set()
        self._cancel_lock = threading.Lock()
        self._active_job_id: str | None = None
        self._active_lock = threading.Lock()
        # A-9: the active-slot gauge lives on the per-app MetricsRegistry.
        # ``metrics`` is None in the subprocess child path
        # (:func:`subprocess_runner._run_job_in_subprocess`) where the
        # child's Prometheus state is isolated from the parent and
        # scrape output comes from the parent's registry only — bumping
        # a disconnected gauge inside the child would be a no-op, so we
        # simply skip it.
        self._metrics = metrics
        # H-0062: per-parent exclusive lock for Re-tune / Resume children.
        # Maps parent_job_id -> child_job_id currently holding the slot.
        # In-memory only; cleared naturally on process restart because
        # any child that was "running" when the old process died is
        # already marked failed at restart time.
        self._parent_locks: dict[str, str] = {}
        self._parent_lock_mutex = threading.Lock()

    def _set_active_gauge(self, value: float) -> None:
        """Update the active-jobs gauge on the bound MetricsRegistry."""
        if self._metrics is not None:
            self._metrics.active_jobs.set(value)

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

    def _job_dir(self, job_id: str) -> Path:
        """Resolve job directory with traversal guard."""
        candidate = (self.jobs_dir / job_id).resolve()
        validate_path_within(candidate, self.jobs_dir)
        return candidate

    # --- Path resolution (A-10) ---

    def job_dir(self, job_id: str) -> Path:
        """Public job directory resolver with traversal guard.

        Callers outside :class:`JobStore` should prefer :meth:`path_for`
        for named artifacts and reserve :meth:`job_dir` for cases that
        need the directory itself (e.g. checkpoint base dir for
        subprocess runners).
        """
        return self._job_dir(job_id)

    def path_for(self, job_id: str, kind: ArtifactKind) -> Path:
        """Resolve the on-disk path of a named job artifact.

        Backed by the module-level :data:`ARTIFACT_FILENAMES` map so the
        layout stays a single source of truth. The returned path is
        already guarded against traversal via :meth:`_job_dir`.
        """
        return self._job_dir(job_id) / ARTIFACT_FILENAMES[kind]

    # --- CRUD ---

    def create(
        self,
        *,
        backend_name: str,
        config: dict[str, Any],
        data_ref: DataRef,
        job_type: Literal["fit", "tune"],
        parent_job_id: str | None = None,
    ) -> Job:
        """Create a new pending job and persist its metadata.

        When *parent_job_id* is provided the new job is recorded as a
        child in the lineage graph (H-0062).
        """
        job_id = f"job_{uuid4().hex[:8]}"
        job = Job(
            job_id=job_id,
            status="pending",
            backend_name=backend_name,
            config=config,
            data_ref=data_ref,
            job_type=job_type,
            created_at=datetime.now(timezone.utc).isoformat(),
            parent_job_id=parent_job_id,
        )
        self._save_meta(job)
        return job

    def get(self, job_id: str) -> Job | None:
        """Load a job by ID. Returns ``None`` if not found."""
        if not self.path_for(job_id, "meta").exists():
            return None
        return self._load_job(job_id)

    def list(
        self,
        *,
        status: str | None = None,
        sort: str = "created_at",
    ) -> list[Job]:
        """List all jobs, optionally filtered/sorted.

        Entries that disappear or become unreadable between ``iterdir``
        and ``_load_job`` (concurrent delete, partial write, corrupted
        meta.json) are skipped with a warning rather than crashing the
        whole listing.
        """
        jobs: list[Job] = []
        if not self.jobs_dir.exists():
            return jobs
        for d in self.jobs_dir.iterdir():
            if not d.is_dir() or not (d / "meta.json").exists():
                continue
            try:
                job = self._load_job(d.name)
            except (FileNotFoundError, OSError, json.JSONDecodeError, KeyError):
                _logger.warning(
                    "Skipping unreadable job directory %s", d.name, exc_info=True
                )
                continue
            if status is None or job.status == status:
                jobs.append(job)
        _SORTABLE_FIELDS = {
            "created_at",
            "completed_at",
            "status",
            "job_type",
            "backend_name",
        }
        safe_sort = sort if sort in _SORTABLE_FIELDS else "created_at"
        reverse = True  # newest first
        jobs.sort(key=lambda j: getattr(j, safe_sort) or "", reverse=reverse)
        return jobs

    def update(self, job: Job) -> None:
        """Persist updated job state to disk."""
        self._save_meta(job)
        if job.fit_result is not None:
            self._write_json(
                self.path_for(job.job_id, "fit_result"),
                asdict(job.fit_result),
            )
        if job.tune_result is not None:
            self._write_json(
                self.path_for(job.job_id, "tune_result"),
                asdict(job.tune_result),
            )

    def delete(self, job_id: str, *, cascade: bool = False) -> builtins.list[str]:
        """Delete a job directory. Returns the list of removed job IDs.

        When *cascade* is True (H-0062), the entire descendant subtree is
        removed recursively.  When False only the requested job is
        removed (existing children become orphaned).  An empty list is
        returned when the job does not exist.
        """
        if not self.job_dir(job_id).exists():
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
                queue.extend(self.get_child_job_ids(current))
        else:
            removed.append(job_id)

        for jid in removed:
            target = self.job_dir(jid)
            if target.exists():
                # ignore_errors: a concurrent request_cancel (#152) can
                # briefly stage a tempfile inside the victim tree, and
                # rmtree's listdir → unlink cycle sees the stale entry
                # and raises FileNotFoundError. The file is about to be
                # deleted anyway; swallow the transient error instead
                # of propagating it out of delete().
                shutil.rmtree(target, ignore_errors=True)
            # Drop any cached deserialized model for this job. Imported
            # here to avoid a top-level cycle with ``job_results``.
            from lizystudio.services.job_results import clear_model_cache_for

            clear_model_cache_for(str(self.path_for(jid, "model")))
        return removed

    # --- H-0062 lineage helpers ---

    def get_child_job_ids(self, parent_job_id: str) -> builtins.list[str]:
        """Return direct children of *parent_job_id* (H-0062)."""
        children: builtins.list[str] = []
        if not self.jobs_dir.exists():
            return children
        for d in self.jobs_dir.iterdir():
            if not d.is_dir() or not (d / "meta.json").exists():
                continue
            try:
                meta = self._read_json(d / "meta.json")
            except (OSError, json.JSONDecodeError):
                continue
            if meta.get("parent_job_id") == parent_job_id:
                children.append(d.name)
        return children

    def get_lineage_tree(self, root_job_id: str) -> dict[str, Any] | None:
        """Return ``{job_id, status, children: [...]}`` rooted at *root_job_id*.

        Returns ``None`` when the root does not exist.  Walks the tree
        recursively with a depth guard (20) to avoid runaway lineages.
        Nodes that hit the depth cap are returned with ``children: []``
        AND ``truncated: True`` so the UI can surface the cut-off
        explicitly instead of silently dropping descendants.
        """
        root = self.get(root_job_id)
        if root is None:
            return None
        max_depth = 20

        def _build(job: Job, depth: int) -> dict[str, Any]:
            node: dict[str, Any] = {
                "job_id": job.job_id,
                "status": job.status,
                "job_type": job.job_type,
                "children": [],
                "truncated": False,
            }
            if depth >= max_depth:
                # Mark truncated only if the node actually has children
                # we are about to drop; otherwise it is a real leaf.
                if self.get_child_job_ids(job.job_id):
                    node["truncated"] = True
                return node
            for cid in self.get_child_job_ids(job.job_id):
                child = self.get(cid)
                if child is None:
                    # Meta.json missing / corrupt. Log rather than
                    # silently dropping so a broken child is visible
                    # in the server log instead of the UI claiming a
                    # clean lineage.
                    _logger.warning(
                        "lineage: child %s listed under %s but cannot be loaded",
                        cid,
                        job.job_id,
                    )
                    continue
                node["children"].append(_build(child, depth + 1))
            return node

        return _build(root, 0)

    def has_active_children(self, parent_job_id: str) -> bool:
        """Return True when any direct child is pending or running (H-0062).

        Only walks direct children, not the whole descendant tree. This
        matches the Phase B MVP invariant that nested Re-tune is
        rejected server-side (``_require_tune_job_with_checkpoint``
        blocks grandchild creation), so no grandchildren can exist and
        a direct-child scan is complete. If the nested-retune
        restriction is ever relaxed, this helper must be rewritten as a
        full subtree walk, otherwise cascade-delete guards will miss
        running grandchildren and silently destroy their work.
        """
        for cid in self.get_child_job_ids(parent_job_id):
            child = self.get(cid)
            if child is None:
                continue
            if child.status in ("pending", "running"):
                return True
        return False

    # --- H-0062 per-parent exclusive retune / resume lock ---

    def acquire_parent_lock(self, parent_job_id: str, child_job_id: str) -> bool:
        """Try to claim the retune slot for *parent_job_id*.

        Returns ``True`` when the caller now holds the slot, ``False``
        when another child already has it.  The lock is stored in
        memory only; a process restart clears all locks (matching the
        fact that any "running" child from the previous process is
        already considered failed on the next boot).
        """
        with self._parent_lock_mutex:
            if parent_job_id in self._parent_locks:
                return False
            self._parent_locks[parent_job_id] = child_job_id
            return True

    def release_parent_lock(self, parent_job_id: str) -> None:
        """Release the retune slot for *parent_job_id* if held.

        Unlocking an already-unlocked parent is a no-op; this lets
        caller ``finally`` blocks call release unconditionally.
        """
        with self._parent_lock_mutex:
            self._parent_locks.pop(parent_job_id, None)

    def rebind_parent_lock(
        self, parent_job_id: str, expected_holder: str, new_holder: str
    ) -> bool:
        """Atomically swap the lock holder from *expected_holder* to *new_holder*.

        H-0062 Bugfix 2026-04-14 (4): the API layer acquires the parent
        lock with a placeholder id first, then needs to swap that
        placeholder for the real child job id after the child is
        created. Doing it as ``release_parent_lock`` + ``acquire_parent_lock``
        in two separate calls opens a race window where another
        request can claim the slot between the two operations, and
        the second ``acquire_parent_lock`` silently returns ``False``
        without the caller noticing.

        Returns ``True`` when the slot was successfully rebound.
        Returns ``False`` when the slot is empty or held by a different
        holder — in which case the caller must treat their lock grant
        as lost and abort the retune attempt.
        """
        with self._parent_lock_mutex:
            current = self._parent_locks.get(parent_job_id)
            if current != expected_holder:
                return False
            self._parent_locks[parent_job_id] = new_holder
            return True

    def get_locked_child(self, parent_job_id: str) -> str | None:
        """Return the child job currently holding *parent_job_id*'s lock."""
        with self._parent_lock_mutex:
            return self._parent_locks.get(parent_job_id)

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
            tmp_path = self.jobs_dir / f".cancel-{job_id}-{os.getpid()}.tmp"
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

        Thin wrapper over :meth:`path_for` so a malformed job_id cannot
        escape the jobs_dir root.
        """
        return self.path_for(job_id, "cancel_flag")

    # --- Active job tracking (concurrency control) ---

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

        Returns the newly created ``Job`` when the slot was empty, or
        ``None`` when another job already owns it. Unlike the two-step
        ``create(...) + claim_active(...)`` sequence this method never
        produces an orphan ``failed`` job directory for the losing
        caller — nothing is persisted until the slot is actually held.

        The subsequent ``_run_job_core`` will re-invoke ``claim_active``
        with the same job_id; that call is a no-op because the slot is
        already owned by this job.

        Before refusing a request, this method checks whether the
        currently-held slot is actually still running. Terminal jobs
        (``completed`` / ``failed`` / ``cancelled``) have no business
        occupying the slot and can happen if:

        - a subprocess path returned without going through
          ``_run_job_core.finally`` (e.g. the subprocess was killed and
          the release call was skipped),
        - the server restarted mid-job and the in-memory slot was
          re-initialised from disk state, or
        - a cancel request left the runner thread unable to reach the
          release call.

        Rather than locking the workspace out permanently, the slot is
        reclaimed from the stale owner so the user's next fit/tune can
        proceed. The stale job's on-disk state is left untouched.
        """
        with self._active_lock:
            if self._active_job_id is not None:
                stale = self._is_slot_holder_stale_locked()
                if not stale:
                    return None
                _logger.warning(
                    "Active slot held by stale job %s; reclaiming",
                    self._active_job_id,
                )
                self._active_job_id = None
            job = self.create(
                backend_name=backend_name,
                config=config,
                data_ref=data_ref,
                job_type=job_type,
                parent_job_id=parent_job_id,
            )
            self._active_job_id = job.job_id
            self._set_active_gauge(1)
            return job

    def _is_slot_holder_stale_locked(self) -> bool:
        """Return True when the current slot holder is in a terminal state.

        Caller must hold ``self._active_lock``.
        """
        holder = self._active_job_id
        if holder is None:
            return False
        try:
            job = self._load_job(holder)
        except (FileNotFoundError, OSError, json.JSONDecodeError, KeyError):
            # Meta gone or unreadable -> definitely stale.
            return True
        return job.status in ("completed", "failed", "cancelled")

    def claim_active(self, job_id: str) -> bool:
        """Attempt to claim the active slot.

        Returns ``True`` when the slot is empty *or* when it is already
        held by ``job_id`` (idempotent re-claim after
        ``create_and_claim_active`` — the runner thread re-enters this
        with the same id to keep the ownership explicit). Returns
        ``False`` when a different job currently owns the slot.
        """
        with self._active_lock:
            if self._active_job_id is None:
                self._active_job_id = job_id
                self._set_active_gauge(1)
                return True
            # H-0065: the `self._active_job_id == job_id` re-claim
            # branch intentionally skips the gauge update — the
            # gauge was already set to 1 by the original
            # `create_and_claim_active` or `claim_active` call that
            # acquired the slot, and bumping it again would be a
            # no-op.
            return self._active_job_id == job_id

    def release_active(self, job_id: str) -> None:
        """Release the active slot."""
        with self._active_lock:
            if self._active_job_id == job_id:
                self._active_job_id = None
                self._set_active_gauge(0)

    def force_release_active_if(self, expected_job_id: str) -> bool:
        """Atomically release the slot iff it is still held by *expected_job_id*.

        H-0063: ``workspace_reset`` uses this to force-release a stuck
        orphan slot after its cancel wait times out. The two-step
        ``active_job_id`` read + ``release_active(active_id)`` dance is
        racy — between the read and the release another thread could
        claim the slot with a new job id, and the caller would end up
        releasing someone else's slot. This helper keeps the compare
        and the release under a single ``_active_lock`` critical
        section so the operation either releases the exact id the
        caller observed or is a no-op.

        Returns True if the slot was released, False otherwise.
        """
        with self._active_lock:
            if self._active_job_id == expected_job_id:
                self._active_job_id = None
                self._set_active_gauge(0)
                return True
            return False

    def has_active_job(self) -> bool:
        """Check if a job is currently active (running or pending)."""
        with self._active_lock:
            return self._active_job_id is not None

    @property
    def active_job_id(self) -> str | None:
        """Return the currently active job ID, or None."""
        with self._active_lock:
            return self._active_job_id

    def get_log(self, job_id: str) -> str:
        """Read execution log for a job. Returns empty string if not found."""
        log_path = self.path_for(job_id, "log")
        if not log_path.exists():
            return ""
        return log_path.read_text(encoding="utf-8")

    # --- Internal helpers ---

    def _save_meta(self, job: Job) -> None:
        job_dir = self.job_dir(job.job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "job_id": job.job_id,
            "status": job.status,
            "backend_name": job.backend_name,
            "config": job.config,
            "data_ref": asdict(job.data_ref),
            "job_type": job.job_type,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
            "model_path": job.model_path,
            "error": job.error,
            "parent_job_id": job.parent_job_id,
        }
        self._write_json(self.path_for(job.job_id, "meta"), meta)

    def _load_job(self, job_id: str) -> Job:
        meta = self._read_json(self.path_for(job_id, "meta"))

        fit_result = None
        fit_path = self.path_for(job_id, "fit_result")
        if fit_path.exists():
            d = self._read_json(fit_path)
            fit_result = FitSummary(**d)

        tune_result = None
        tune_path = self.path_for(job_id, "tune_result")
        if tune_path.exists():
            d = self._read_json(tune_path)
            tune_result = TuningSummary(**d)

        data_ref_dict = meta["data_ref"]
        data_ref_dict["shape"] = tuple(data_ref_dict["shape"])
        return Job(
            job_id=meta["job_id"],
            status=meta["status"],
            backend_name=meta["backend_name"],
            config=meta["config"],
            data_ref=DataRef(**data_ref_dict),
            job_type=meta["job_type"],
            created_at=meta["created_at"],
            completed_at=meta.get("completed_at"),
            fit_result=fit_result,
            tune_result=tune_result,
            model_path=meta.get("model_path"),
            error=meta.get("error"),
            parent_job_id=meta.get("parent_job_id"),
        )

    @staticmethod
    def _write_json(path: Path, data: dict[str, Any]) -> None:
        """Write a Studio-owned JSON artefact with ``format_version`` embedded.

        Routes through :func:`lizystudio.storage.versions.write_versioned_json`
        (C-9 / H-0081) so every persisted file declares its schema
        version. ``data`` must already be a dict — fit/tune results and
        job meta all derive from ``asdict(...)`` so this is satisfied
        at the one call site that serialises a dataclass directly.
        """
        write_versioned_json(path, data)

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        """Load a versioned JSON artefact and run migrations if needed.

        Returns the migrated domain payload with the ``format_version``
        sentinel stripped, so callers consume the same shape regardless
        of whether the file was written by a pre-C-9 or post-C-9
        runtime (missing key is treated as v0 per H-0081).
        """
        _, payload = read_versioned_json(path)
        return payload


def get_job_store(request: Request) -> JobStore:
    """FastAPI dependency — retrieve job store from app.state."""
    return request.app.state.job_store  # type: ignore[no-any-return]


# --- Back-compat re-exports (A-7: dispatch helpers moved to job_results) ---
# External callers historically import these from services.jobs. The logic
# now lives in services/job_results.py alongside the model LRU cache.
from lizystudio.services.job_results import (  # noqa: E402
    _get_jobs_dir,
    _load_tuning_plot_from_file,
    clear_model_cache,
    clear_model_cache_for,
    get_available_plots,
    get_importance,
    get_importance_kinds,
    get_job_plot,
    get_learning_curve_metrics,
    get_metrics_table,
    get_split_summary,
    load_job_model,
)

__all__ = [
    "CANCEL_FLAG_FILENAME",
    "Job",
    "JobStore",
    "_get_jobs_dir",
    "_load_tuning_plot_from_file",
    "clear_model_cache",
    "clear_model_cache_for",
    "get_available_plots",
    "get_importance",
    "get_importance_kinds",
    "get_job_plot",
    "get_job_store",
    "get_learning_curve_metrics",
    "get_metrics_table",
    "get_split_summary",
    "load_job_model",
]
