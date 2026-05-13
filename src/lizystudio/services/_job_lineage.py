"""Job lineage — parent/child graph + per-parent retune lock (#451).

Extracted from ``JobStore``. Two related concerns for Re-tune / Resume
child jobs (H-0062):

- **Lineage queries** — ``get_child_job_ids`` / ``get_lineage_tree`` /
  ``has_active_children`` walk the on-disk ``meta.json`` files (via the
  injected :class:`~lizystudio.services._job_metadata.JobMetadataStore`)
  to reconstruct the parent → child graph. The graph itself is not
  stored; it is derived from each job's ``parent_job_id`` field.
- **Per-parent exclusive lock** — ``acquire_parent_lock`` /
  ``release_parent_lock`` / ``rebind_parent_lock`` / ``get_locked_child``
  serialise Re-tune / Resume so at most one child per parent is in
  flight. In-memory only (a process restart clears all locks, matching
  the fact that any "running" child from the previous process is already
  considered failed on the next boot).
"""

from __future__ import annotations

import builtins
import json
import logging
import threading
from typing import Any

from lizystudio.services._job_metadata import Job, JobMetadataStore, read_job_json

_logger = logging.getLogger(__name__)


class JobLineage:
    """Parent/child lineage queries + per-parent retune lock. Thread-safe.

    The lineage queries delegate disk access to the injected
    ``JobMetadataStore`` (``jobs_dir`` for the directory scan, ``get``
    for full-job loads). The retune lock is a self-contained in-memory
    ``dict`` guarded by its own mutex.
    """

    def __init__(self, metadata: JobMetadataStore) -> None:
        self._metadata = metadata
        # H-0062: per-parent exclusive lock for Re-tune / Resume children.
        # Maps parent_job_id -> child_job_id currently holding the slot.
        # In-memory only; cleared naturally on process restart because
        # any child that was "running" when the old process died is
        # already marked failed at restart time.
        self._parent_locks: dict[str, str] = {}
        self._parent_lock_mutex = threading.Lock()

    # --- H-0062 lineage queries ---

    def get_child_job_ids(self, parent_job_id: str) -> builtins.list[str]:
        """Return direct children of *parent_job_id* (H-0062).

        Scans ``jobs_dir`` and reads each ``meta.json``'s ``parent_job_id``;
        directories that vanish or are unreadable mid-scan are skipped.
        """
        children: builtins.list[str] = []
        if not self._metadata.jobs_dir.exists():
            return children
        for d in self._metadata.jobs_dir.iterdir():
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
        root = self._metadata.get(root_job_id)
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
                child = self._metadata.get(cid)
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
            child = self._metadata.get(cid)
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
