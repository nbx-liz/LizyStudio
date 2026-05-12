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
import contextlib
import json
import logging
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from fastapi import Request

from lizystudio.backends.types import DataRef

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
        # #451: the disk-CRUD half (path resolution, create/get/list/update,
        # meta.json round-trips) is delegated to ``JobMetadataStore``.
        # ``self.jobs_dir`` is kept (and aliases the metadata store's) for
        # the many call sites that read it directly.
        self._meta = JobMetadataStore(jobs_dir)
        self.jobs_dir = self._meta.jobs_dir
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

    # --- Path resolution (A-10) — delegated to JobMetadataStore (#451) ---

    def job_dir(self, job_id: str) -> Path:
        """Resolve the job directory (traversal-guarded). See
        :meth:`JobMetadataStore.job_dir`."""
        return self._meta.job_dir(job_id)

    def path_for(self, job_id: str, kind: ArtifactKind) -> Path:
        """Resolve a named job artifact path. See
        :meth:`JobMetadataStore.path_for`."""
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
        """Create a new pending job and persist its metadata.

        When *parent_job_id* is provided the new job is recorded as a
        child in the lineage graph (H-0062). See
        :meth:`JobMetadataStore.create`.
        """
        return self._meta.create(
            backend_name=backend_name,
            config=config,
            data_ref=data_ref,
            job_type=job_type,
            parent_job_id=parent_job_id,
        )

    def get(self, job_id: str) -> Job | None:
        """Load a job by ID. Returns ``None`` if not found. See
        :meth:`JobMetadataStore.get`."""
        return self._meta.get(job_id)

    def list(
        self,
        *,
        status: str | None = None,
        sort: str = "created_at",
    ) -> builtins.list[Job]:
        """List all jobs, optionally filtered/sorted. See
        :meth:`JobMetadataStore.list`."""
        return self._meta.list(status=status, sort=sort)

    def update(self, job: Job) -> None:
        """Persist updated job state to disk (meta + result sidecars).
        See :meth:`JobMetadataStore.update`."""
        self._meta.update(job)

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
            # Drop any cached deserialised model for this job via the
            # JobStore-owned cache (H-0084).
            self.clear_model_cache_for(str(self.path_for(jid, "model")))
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
                meta = read_job_json(d / "meta.json")
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
        """Return True when any direct child is pending, running, or
        paused (H-0062, P-0099 v3-20c).

        Only walks direct children, not the whole descendant tree. This
        matches the Phase B MVP invariant that nested Re-tune is
        rejected server-side (``_require_tune_job_with_checkpoint``
        blocks grandchild creation), so no grandchildren can exist and
        a direct-child scan is complete. If the nested-retune
        restriction is ever relaxed, this helper must be rewritten as a
        full subtree walk, otherwise cascade-delete guards will miss
        running grandchildren and silently destroy their work.

        v3-20c: ``paused`` also counts as active — a paused tune holds
        the workspace's training slot AND owns the Optuna sqlite that
        feeds the resume worker, so a non-cascade delete of the parent
        would silently destroy resume state otherwise.
        """
        for cid in self.get_child_job_ids(parent_job_id):
            child = self.get(cid)
            if child is None:
                continue
            if child.status in ("pending", "running", "paused"):
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

    # --- Pause / unpause (P-0099 v3-20c, R-1.4) ---

    def request_pause(self, job_id: str) -> None:
        """Mark a job for pause (R-1.4 / Issue #360).

        Mirrors :meth:`request_cancel`: the in-memory set is the source
        of truth for same-process callers, and ``<job_dir>/PAUSE`` is the
        IPC channel a subprocess child reads through its own fresh
        :class:`JobStore`. The cancel-aware callback raises
        :class:`PausedError` instead of :class:`CancelledError` when this
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
            tmp_path = self.jobs_dir / f".pause-{job_id}-{os.getpid()}.tmp"
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
        :class:`PausedError` again on the same flag.
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
        return self.path_for(job_id, "pause_flag")

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
        job = self.get(job_id)
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
        self.update(job)

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
        for job in self.list():
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
            self.update(job)

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
                self.update(job)
            paused_candidates = [winner]

        if paused_candidates:
            survivor = paused_candidates[0]
            with self._active_lock:
                self._active_job_id = survivor.job_id
                self._set_active_gauge(1)
            _logger.info(
                "Re-attached paused job %s to active slot at startup",
                survivor.job_id,
            )

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
            job = self._meta.load_job(holder)
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
