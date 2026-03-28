"""Jobs API router (BLUEPRINT §5.3).

Covers: list, get, config, metrics, split-summary, importance, plot, plots,
export, delete.
"""

from __future__ import annotations

import re
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from lizystudio.api.errors import (
    BackendError,
    JobNotCompletedError,
    JobNotFoundError,
    JobRunningError,
    StudioError,
)
from lizystudio.services.export import export_code_as_zip, export_model, export_report
from lizystudio.services.jobs import (
    Job,
    JobStore,
    get_available_plots,
    get_importance,
    get_importance_kinds,
    get_job_plot,
    get_job_store,
    get_metrics_table,
    get_split_summary,
)
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


def _sanitize_error(error: str | None) -> str | None:
    """Strip stack traces from error messages for API responses."""
    if not error:
        return error
    # Keep only the first line (e.g. "ValueError: invalid config")
    return error.split("\n", 1)[0]


def _job_summary(job: Job) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "job_id": job.job_id,
        "status": job.status,
        "backend_name": job.backend_name,
        "job_type": job.job_type,
        "created_at": job.created_at,
        "completed_at": job.completed_at,
        "error": _sanitize_error(job.error),
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
                if isinstance(first_value, int | float):
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
    """Delete a job. Running jobs cannot be deleted (v2-13 task 2)."""
    job = _get_job_or_404(job_id, job_store)
    if job.status == "running":
        raise JobRunningError(job_id)
    if not job_store.delete(job_id):
        raise JobNotFoundError(job_id)
    return {"status": "deleted"}


@router.post("/{job_id}/cancel")
def cancel_job(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, str]:
    """Cancel a running job (H-0011)."""
    job = _get_job_or_404(job_id, job_store)
    if job.status != "running":
        raise StudioError(
            "JOB_NOT_RUNNING",
            f"Job {job_id} is not running (status: {job.status})",
            400,
        )
    job_store.request_cancel(job_id)
    return {"status": "cancelled"}


# --- Result viewing ---


@router.get("/{job_id}/metrics")
def get_job_metrics_endpoint(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> list[dict[str, Any]]:
    """Get metrics table (evaluate_table)."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        return get_metrics_table(job, ws.backend)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/split-summary")
def get_job_split_summary_endpoint(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> list[dict[str, Any]]:
    """Get fold/split summary."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        return get_split_summary(job, ws.backend)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/importance")
def get_job_importance_endpoint(
    job_id: str,
    kind: str = "split",
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, float]:
    """Get feature importance."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        return get_importance(job, ws.backend, kind=kind)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/importance-kinds")
def get_job_importance_kinds_endpoint(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> list[str]:
    """Get the list of valid importance kind identifiers."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        return get_importance_kinds(job, ws.backend)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/plot/{plot_type}")
def get_job_plot_endpoint(
    job_id: str,
    plot_type: str,
    metrics: str | None = None,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, str]:
    """Get a Plotly figure as JSON.

    For ``learning-curve``, pass ``?metrics=auc,f1`` to filter subplots.
    """
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    kwargs: dict[str, Any] = {}
    if metrics is not None and plot_type == "learning-curve":
        parsed = [m.strip() for m in metrics.split(",") if m.strip()]
        _MAX_METRICS = 20
        _VALID_METRIC_RE = re.compile(r"^[a-zA-Z0-9_]+$")
        if len(parsed) > _MAX_METRICS:
            raise StudioError(
                "INVALID_PARAM",
                f"Too many metrics (max {_MAX_METRICS})",
                400,
            )
        invalid = [m for m in parsed if not _VALID_METRIC_RE.match(m)]
        if invalid:
            raise StudioError(
                "INVALID_PARAM",
                f"Invalid metric name(s): {invalid}",
                400,
            )
        kwargs["metrics"] = parsed
    try:
        plot_data = get_job_plot(job, ws.backend, plot_type, **kwargs)
        return {"plotly_json": plot_data.plotly_json}
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/plots")
def get_job_available_plots_endpoint(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> list[str]:
    """Get list of available plot types for this job."""
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        return get_available_plots(job, ws.backend)
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
    from pathlib import Path as _Path

    import lizystudio.security as security
    from lizystudio.security import validate_path_within

    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    validate_path_within(_Path(body.output_path), security.ALLOWED_FILES_ROOT)
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


@router.post("/{job_id}/export-code")
def export_code(
    job_id: str,
    background_tasks: BackgroundTasks,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> FileResponse:
    """Generate standalone Python code and return it as a ZIP download (H-0027)."""
    import os

    job = _get_job_or_404(job_id, job_store)
    if job.status != "completed" or job.model_path is None:
        raise JobNotCompletedError(job_id)
    try:
        zip_path = export_code_as_zip(job=job, backend=ws.backend)
    except Exception as exc:
        raise BackendError(exc) from exc
    # Schedule cleanup of the temporary ZIP file after the response is sent
    background_tasks.add_task(os.unlink, str(zip_path))
    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=f"job_{job_id}_code.zip",
    )
