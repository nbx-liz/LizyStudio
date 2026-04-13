"""Job persistence — CRUD for fit/tune jobs on disk (BLUEPRINT §3.4.2/§3.4.4)."""

from __future__ import annotations

import builtins
import json
import shutil
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import Request

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.security import validate_path_within  # noqa: E402


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

    def __init__(self, jobs_dir: Path) -> None:
        self.jobs_dir = jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._cancel_requested: set[str] = set()
        self._cancel_lock = threading.Lock()
        self._active_job_id: str | None = None
        self._active_lock = threading.Lock()
        # H-0062: per-parent exclusive lock for Re-tune / Resume children.
        # Maps parent_job_id -> child_job_id currently holding the slot.
        # In-memory only; cleared naturally on process restart because
        # any child that was "running" when the old process died is
        # already marked failed at restart time.
        self._parent_locks: dict[str, str] = {}
        self._parent_lock_mutex = threading.Lock()

    def _job_dir(self, job_id: str) -> Path:
        """Resolve job directory with traversal guard."""
        candidate = (self.jobs_dir / job_id).resolve()
        validate_path_within(candidate, self.jobs_dir)
        return candidate

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
        meta_path = self._job_dir(job_id) / "meta.json"
        if not meta_path.exists():
            return None
        return self._load_job(job_id)

    def list(
        self,
        *,
        status: str | None = None,
        sort: str = "created_at",
    ) -> list[Job]:
        """List all jobs, optionally filtered/sorted."""
        jobs: list[Job] = []
        if not self.jobs_dir.exists():
            return jobs
        for d in self.jobs_dir.iterdir():
            if d.is_dir() and (d / "meta.json").exists():
                job = self._load_job(d.name)
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
                self.jobs_dir / job.job_id / "fit_result.json",
                asdict(job.fit_result),
            )
        if job.tune_result is not None:
            self._write_json(
                self.jobs_dir / job.job_id / "tune_result.json",
                asdict(job.tune_result),
            )

    def delete(self, job_id: str, *, cascade: bool = False) -> builtins.list[str]:
        """Delete a job directory. Returns the list of removed job IDs.

        When *cascade* is True (H-0062), the entire descendant subtree is
        removed recursively.  When False only the requested job is
        removed (existing children become orphaned).  An empty list is
        returned when the job does not exist.
        """
        if not self._job_dir(job_id).exists():
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
            target = self._job_dir(jid)
            if target.exists():
                shutil.rmtree(target)
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

        Returns ``None`` when the root does not exist.  Iterative BFS
        with a depth guard (20) to avoid runaway lineages.
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
            }
            if depth >= max_depth:
                return node
            for cid in self.get_child_job_ids(job.job_id):
                child = self.get(cid)
                if child is not None:
                    node["children"].append(_build(child, depth + 1))
            return node

        return _build(root, 0)

    def has_active_children(self, parent_job_id: str) -> bool:
        """Return True when any direct child is pending or running (H-0062)."""
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

    def get_locked_child(self, parent_job_id: str) -> str | None:
        """Return the child job currently holding *parent_job_id*'s lock."""
        with self._parent_lock_mutex:
            return self._parent_locks.get(parent_job_id)

    def request_cancel(self, job_id: str) -> None:
        """Mark a job for cancellation (H-0011)."""
        with self._cancel_lock:
            self._cancel_requested.add(job_id)

    def is_cancel_requested(self, job_id: str) -> bool:
        """Check whether cancellation was requested for a job."""
        with self._cancel_lock:
            return job_id in self._cancel_requested

    def clear_cancel(self, job_id: str) -> None:
        """Clear cancellation flag after processing."""
        with self._cancel_lock:
            self._cancel_requested.discard(job_id)

    # --- Active job tracking (concurrency control) ---

    def claim_active(self, job_id: str) -> bool:
        """Attempt to claim the active slot. Returns False if another job is active."""
        with self._active_lock:
            if self._active_job_id is not None:
                return False
            self._active_job_id = job_id
            return True

    def release_active(self, job_id: str) -> None:
        """Release the active slot."""
        with self._active_lock:
            if self._active_job_id == job_id:
                self._active_job_id = None

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
        log_path = self._job_dir(job_id) / "execution.log"
        if not log_path.exists():
            return ""
        return log_path.read_text(encoding="utf-8")

    # --- Internal helpers ---

    def _save_meta(self, job: Job) -> None:
        job_dir = self._job_dir(job.job_id)
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
        self._write_json(job_dir / "meta.json", meta)

    def _load_job(self, job_id: str) -> Job:
        job_dir = self._job_dir(job_id)
        meta = self._read_json(job_dir / "meta.json")

        fit_result = None
        fit_path = job_dir / "fit_result.json"
        if fit_path.exists():
            d = self._read_json(fit_path)
            fit_result = FitSummary(**d)

        tune_result = None
        tune_path = job_dir / "tune_result.json"
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
    def _write_json(path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(data, ensure_ascii=False, default=str)
        path.write_text(text, encoding="utf-8")

    @staticmethod
    def _read_json(path: Path) -> Any:
        return json.loads(path.read_text(encoding="utf-8"))


def get_job_store(request: Request) -> JobStore:
    """FastAPI dependency — retrieve job store from app.state."""
    return request.app.state.job_store  # type: ignore[no-any-return]


# --- Service-layer helpers for job results (Phase 20) ---


def load_job_model(job: Job, backend: BackendAdapter) -> Any:
    """Load a trained model from a completed job."""
    if job.model_path is None:
        msg = f"Job {job.job_id} has no saved model"
        raise ValueError(msg)
    return backend.load_model(job.model_path)


def get_metrics_table(job: Job, backend: BackendAdapter) -> list[dict[str, Any]]:
    """Get the metrics evaluation table for a completed job."""
    model = load_job_model(job, backend)
    return backend.evaluate_table(model)


def get_split_summary(job: Job, backend: BackendAdapter) -> list[dict[str, Any]]:
    """Get fold/split summary for a completed job."""
    model = load_job_model(job, backend)
    return backend.split_summary(model)


def get_importance(
    job: Job, backend: BackendAdapter, kind: str = "split"
) -> dict[str, float]:
    """Get feature importance for a completed job."""
    model = load_job_model(job, backend)
    return backend.importance(model, kind=kind)


def get_importance_kinds(job: Job, backend: BackendAdapter) -> list[str]:
    """Get the list of valid importance kind identifiers for a completed job."""
    model = load_job_model(job, backend)
    return backend.importance_kinds(model)


def get_learning_curve_metrics(job: Job, backend: BackendAdapter) -> list[str]:
    """Get the list of metric names available in the learning curve history."""
    model = load_job_model(job, backend)
    return backend.learning_curve_metrics(model)


def _get_jobs_dir(job: Job) -> Path | None:
    """Derive the jobs directory from a job's model_path."""
    if job.model_path:
        return Path(job.model_path).parent.parent
    return None


def _load_tuning_plot_from_file(job: Job) -> Any:
    """Load a saved tuning plot JSON from disk (fallback for exported models)."""
    from lizystudio.backends.types import PlotData

    jobs_dir = _get_jobs_dir(job)
    if jobs_dir is None:
        return None
    path = jobs_dir / job.job_id / "tuning_plot.json"
    if not path.exists():
        return None
    return PlotData(plotly_json=path.read_text(encoding="utf-8"))


def get_job_plot(
    job: Job, backend: BackendAdapter, plot_type: str, **kwargs: Any
) -> Any:
    """Get a plot for a completed job. Returns PlotData."""
    model = load_job_model(job, backend)
    # For tuning plots, the exported model may lack Optuna study data.
    # Fall back to the saved file captured at tune time.
    if plot_type == "tuning":
        try:
            return backend.plot(model, plot_type, **kwargs)
        except Exception:  # noqa: BLE001
            saved = _load_tuning_plot_from_file(job)
            if saved is not None:
                return saved
            raise
    return backend.plot(model, plot_type, **kwargs)


def get_available_plots(job: Job, backend: BackendAdapter) -> list[str]:
    """Get list of available plot types for a completed job."""
    model = load_job_model(job, backend)
    plots = list(backend.available_plots(model))
    # If tuning plot file exists but model doesn't have tuning data, add it
    if "tuning" not in plots and job.job_type == "tune":
        saved = _load_tuning_plot_from_file(job)
        if saved is not None:
            plots.append("tuning")
    return plots
