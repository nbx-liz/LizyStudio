"""Job persistence — CRUD for fit/tune jobs on disk (BLUEPRINT §3.4.2/§3.4.4)."""

from __future__ import annotations

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

    def _job_dir(self, job_id: str) -> Path:
        """Resolve job directory with traversal guard."""
        candidate = (self.jobs_dir / job_id).resolve()
        root = self.jobs_dir.resolve()
        if not str(candidate).startswith(str(root) + "/"):
            msg = f"job_id escapes jobs_dir: {job_id!r}"
            raise ValueError(msg)
        return candidate

    # --- CRUD ---

    def create(
        self,
        *,
        backend_name: str,
        config: dict[str, Any],
        data_ref: DataRef,
        job_type: Literal["fit", "tune"],
    ) -> Job:
        """Create a new pending job and persist its metadata."""
        job_id = f"job_{uuid4().hex[:8]}"
        job = Job(
            job_id=job_id,
            status="pending",
            backend_name=backend_name,
            config=config,
            data_ref=data_ref,
            job_type=job_type,
            created_at=datetime.now(timezone.utc).isoformat(),
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

    def delete(self, job_id: str) -> bool:
        """Delete a job directory. Returns True if it existed."""
        job_dir = self._job_dir(job_id)
        if job_dir.exists():
            shutil.rmtree(job_dir)
            return True
        return False

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
