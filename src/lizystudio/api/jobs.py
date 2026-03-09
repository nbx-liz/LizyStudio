"""Jobs API router (BLUEPRINT §5.3).

Covers: list, get, config, metrics, split-summary, importance, plot, plots,
export, delete.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from lizystudio.api.errors import (
    BackendError,
    JobNotCompletedError,
    JobNotFoundError,
)
from lizystudio.services.export import export_model, export_report
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
    summary: dict[str, Any] = {
        "job_id": job.job_id,
        "status": job.status,
        "backend_name": job.backend_name,
        "job_type": job.job_type,
        "created_at": job.created_at,
        "completed_at": job.completed_at,
        "error": job.error,
    }

    # Model name from config
    model_name = ""
    if job.config:
        model_name = job.config.get("model", {}).get("name", "")
    summary["model_name"] = model_name

    # Primary score: first OOS metric value from fit_result
    primary_score: float | None = None
    if job.status == "completed" and job.fit_result is not None:
        raw = job.fit_result.metrics.get("raw", {})
        if isinstance(raw, dict):
            oof = raw.get("oof", {})
            if isinstance(oof, dict) and oof:
                first_value = next(iter(oof.values()))
                if isinstance(first_value, (int, float)):
                    primary_score = float(first_value)
    summary["primary_score"] = primary_score

    return summary


# --- CRUD ---


@router.get("/")
@router.get("", include_in_schema=False)
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


@router.get("/{job_id}/log")
def get_job_log(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, str]:
    """Get the execution log for a job (H-0006)."""
    _get_job_or_404(job_id, job_store)
    return {"log": job_store.get_log(job_id)}


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


# --- Export ---


class ExportRequest(BaseModel):
    export_type: str  # "model" or "report"
    output_path: str


@router.post("/{job_id}/export")
def export_job(
    job_id: str,
    body: ExportRequest,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, str]:
    """Export model or report to the given path (H-0005)."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        if body.export_type == "report":
            path = export_report(
                job=job, backend=ws.backend, output_path=body.output_path
            )
        else:
            path = export_model(
                job=job, backend=ws.backend, output_path=body.output_path
            )
        return {"exported_path": path, "export_type": body.export_type}
    except Exception as exc:
        raise BackendError(exc) from exc
