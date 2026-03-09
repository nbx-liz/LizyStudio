"""Jobs API router (BLUEPRINT §5.3).

Covers: list, get, config, metrics, split-summary, importance, plot, plots, delete.
Export endpoint added in Phase 6.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends

from lizystudio.api.errors import (
    BackendError,
    JobNotCompletedError,
    JobNotFoundError,
)
from lizystudio.services.jobs import Job, JobStore, get_job_store
from lizystudio.services.workspace import WorkspaceState, get_workspace

router = APIRouter()


# --- Helpers ---


def _get_job_or_404(job_id: str, job_store: JobStore) -> Job:
    job = job_store.get(job_id)
    if job is None:
        raise JobNotFoundError(job_id)
    return job


def _require_completed(job: Job) -> None:
    if job.status != "completed":
        raise JobNotCompletedError(job.job_id)


def _load_model(job: Job, ws: WorkspaceState) -> Any:
    if job.model_path is None:
        raise JobNotCompletedError(job.job_id)
    return ws.backend.load_model(job.model_path)


def _job_summary(job: Job) -> dict[str, Any]:
    return {
        "job_id": job.job_id,
        "status": job.status,
        "backend_name": job.backend_name,
        "job_type": job.job_type,
        "created_at": job.created_at,
        "completed_at": job.completed_at,
        "error": job.error,
    }


# --- CRUD ---


@router.get("/")
def list_jobs(
    status: str | None = None,
    sort: str = "created_at",
    job_store: JobStore = Depends(get_job_store),
) -> list[dict[str, Any]]:
    """List all jobs, optionally filtered by status."""
    jobs = job_store.list(status=status, sort=sort)
    return [_job_summary(j) for j in jobs]


@router.get("/{job_id}")
def get_job(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Get job details."""
    job = _get_job_or_404(job_id, job_store)
    result: dict[str, Any] = _job_summary(job)
    if job.fit_result is not None:
        result["fit_result"] = asdict(job.fit_result)
    if job.tune_result is not None:
        result["tune_result"] = asdict(job.tune_result)
    return result


@router.get("/{job_id}/config")
def get_job_config(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Get the config used for this job."""
    job = _get_job_or_404(job_id, job_store)
    return job.config


@router.delete("/{job_id}")
def delete_job(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, str]:
    """Delete a job."""
    if not job_store.delete(job_id):
        raise JobNotFoundError(job_id)
    return {"status": "deleted"}


# --- Result viewing ---


@router.get("/{job_id}/metrics")
def get_job_metrics(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> list[dict[str, Any]]:
    """Get metrics table (evaluate_table)."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        model = _load_model(job, ws)
        return ws.backend.evaluate_table(model)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/split-summary")
def get_job_split_summary(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> list[dict[str, Any]]:
    """Get fold/split summary."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        model = _load_model(job, ws)
        return ws.backend.split_summary(model)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/importance")
def get_job_importance(
    job_id: str,
    kind: str = "split",
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, float]:
    """Get feature importance."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        model = _load_model(job, ws)
        return ws.backend.importance(model, kind=kind)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/plot/{plot_type}")
def get_job_plot(
    job_id: str,
    plot_type: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, str]:
    """Get a Plotly figure as JSON."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        model = _load_model(job, ws)
        plot_data = ws.backend.plot(model, plot_type)
        return {"plotly_json": plot_data.plotly_json}
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/plots")
def get_job_available_plots(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> list[str]:
    """Get list of available plot types for this job."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        model = _load_model(job, ws)
        return ws.backend.available_plots(model)
    except Exception as exc:
        raise BackendError(exc) from exc
