"""Jobs API router (BLUEPRINT §5.3).

Covers: list, get, config, metrics, split-summary, importance, plot, plots,
export, delete.
"""

from __future__ import annotations

import re
from dataclasses import asdict
from typing import Any, Literal  # noqa: UP035

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from lizystudio.api.errors import (
    BackendError,
    ExportError,
    JobNotCompletedError,
    JobNotFoundError,
    JobRunningError,
    ParentHasActiveChildrenError,
    PlotNotAvailableError,
    StudioError,
)
from lizystudio.api.models import (
    CancelJobResponse,
    DeleteJobResponse,
    ExportCodeResponse,
    ExportJobResponse,
    JobDetailResponse,
    JobLogResponse,
    JobSummaryResponse,
    PlotResponseModel,
)
from lizystudio.backends.exceptions import (
    PlotNotAvailableError as _BackendPlotNotAvailable,
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
    get_learning_curve_metrics,
    get_metrics_table,
    get_split_summary,
)
from lizystudio.services.workspace import WorkspaceState, get_workspace

_MAX_METRICS = 20
_VALID_PARAM_RE = re.compile(r"^[a-zA-Z0-9_]+$")

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
        # H-0062: lineage field for Re-tune / Resume children. Always
        # present in the summary so consumers can distinguish "root
        # job" (null) from "missing key" (undefined).
        "parent_job_id": job.parent_job_id,
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


@router.get("/", response_model=list[JobSummaryResponse])
@router.get("", include_in_schema=False)
def list_jobs(
    status: str | None = None,
    sort: str = "created_at",
    job_store: JobStore = Depends(get_job_store),
) -> list[dict[str, Any]]:
    """List all jobs, optionally filtered by status."""
    jobs = job_store.list(status=status, sort=sort)
    return [_job_summary(j) for j in jobs]


@router.get("/{job_id}", response_model=JobDetailResponse)
def get_job(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Get job details."""
    job = _get_job_or_404(job_id, job_store)
    result: dict[str, Any] = _job_summary(job)
    result["config"] = job.config
    if job.fit_result is not None:
        result["fit_result"] = asdict(job.fit_result)
    if job.tune_result is not None:
        result["tune_result"] = asdict(job.tune_result)
    return result


@router.get("/{job_id}/log", response_model=JobLogResponse)
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


@router.delete("/{job_id}", response_model=DeleteJobResponse)
def delete_job(
    job_id: str,
    cascade: bool = False,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Delete a job. Running jobs cannot be deleted (v2-13 task 2).

    Pass ``?cascade=true`` to remove the entire descendant subtree
    created by Re-tune / Resume children (H-0062). When children are
    currently pending or running, cascade is required; otherwise the
    request is rejected with ``PARENT_HAS_ACTIVE_CHILDREN``.
    """
    job = _get_job_or_404(job_id, job_store)
    if job.status == "running":
        raise JobRunningError(job_id)

    # H-0062: guard against orphaning in-flight children on a non-cascade
    # delete. Collect the direct active descendants first so the error
    # details list exactly what would be lost.
    if not cascade and job_store.has_active_children(job_id):
        active: list[str] = []
        for cid in job_store.get_child_job_ids(job_id):
            child = job_store.get(cid)
            if child is not None and child.status in ("pending", "running"):
                active.append(cid)
        raise ParentHasActiveChildrenError(job_id, active)

    if cascade:
        # Active running/pending children must be asked to stop before we
        # rmtree their directories. Cancel flags are best-effort; the
        # actual subprocess may still be running when rmtree fires, but
        # the run_tune wrapper tolerates a missing job dir via its finally
        # block.
        for cid in job_store.get_child_job_ids(job_id):
            child = job_store.get(cid)
            if child is not None and child.status in ("pending", "running"):
                job_store.request_cancel(cid)
        removed = job_store.delete(job_id, cascade=True)
    else:
        removed = job_store.delete(job_id)

    if not removed:
        raise JobNotFoundError(job_id)
    return {"status": "deleted", "removed_job_ids": removed}


@router.post("/{job_id}/cancel", response_model=CancelJobResponse)
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
        return get_metrics_table(job, ws.backend, job_store.model_cache)
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
        return get_split_summary(job, ws.backend, job_store.model_cache)
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
        return get_importance(job, ws.backend, job_store.model_cache, kind=kind)
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
        return get_importance_kinds(job, ws.backend, job_store.model_cache)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/learning-curve/metrics")
def get_job_learning_curve_metrics_endpoint(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> list[str]:
    """Get the metric names recorded in the learning curve history.

    These are the values accepted by the learning-curve plot's ``metrics``
    filter. Sourced from the actual training eval history — they may
    differ from the user's configured evaluation metrics.
    """
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        return get_learning_curve_metrics(job, ws.backend, job_store.model_cache)
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{job_id}/plot/{plot_type}", response_model=PlotResponseModel)
def get_job_plot_endpoint(
    job_id: str,
    plot_type: str,
    metrics: str | None = None,
    kind: str | None = None,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, str]:
    """Get a Plotly figure as JSON.

    For ``learning-curve``, pass ``?metrics=auc,f1`` to filter subplots.
    For ``importance``, pass ``?kind=split|gain|shap`` to select kind.
    """
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    kwargs: dict[str, Any] = {}
    if metrics is not None and plot_type == "learning-curve":
        parsed = [m.strip() for m in metrics.split(",") if m.strip()]
        if len(parsed) > _MAX_METRICS:
            raise StudioError(
                "INVALID_PARAM",
                f"Too many metrics (max {_MAX_METRICS})",
                400,
            )
        invalid = [m for m in parsed if not _VALID_PARAM_RE.match(m)]
        if invalid:
            raise StudioError(
                "INVALID_PARAM",
                f"Invalid metric name(s): {invalid}",
                400,
            )
        kwargs["metrics"] = parsed
    if kind is not None and plot_type == "importance":
        if not _VALID_PARAM_RE.match(kind):
            raise StudioError("INVALID_PARAM", f"Invalid kind: {kind!r}", 400)
        kwargs["kind"] = kind
    try:
        plot_data = get_job_plot(
            job, ws.backend, job_store.model_cache, plot_type, **kwargs
        )
        return {"plotly_json": plot_data.plotly_json}
    except _BackendPlotNotAvailable as exc:
        # Issue #355: 404 (client asked for an unsupported plot)
        # rather than 500 (genuine backend failure).
        raise PlotNotAvailableError(exc.plot_type, exc.available) from exc
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
        return get_available_plots(job, ws.backend, job_store.model_cache)
    except Exception as exc:
        raise BackendError(exc) from exc


# --- Export ---


def _build_export_filename(job: Job, job_store: JobStore) -> str:
    """Build a descriptive ZIP filename from job metadata.

    Format: {data_stem}_{task}_{model}_job{N}_code.zip
    Example: train_binary_lightgbm_job3_code.zip
    """
    from pathlib import PurePosixPath

    parts: list[str] = []
    # Data source name (stem of the original filename)
    if job.data_ref and job.data_ref.filename:
        stem = PurePosixPath(job.data_ref.filename).stem
        parts.append(stem)
    # Task type
    task = job.config.get("task")
    if task:
        parts.append(str(task))
    # Model name
    model_cfg = job.config.get("model")
    if isinstance(model_cfg, dict) and model_cfg.get("name"):
        parts.append(str(model_cfg["name"]))
    # Job number (same as Jobs list #N display)
    all_jobs = job_store.list()
    idx = next((i for i, j in enumerate(all_jobs) if j.job_id == job.job_id), -1)
    job_number = len(all_jobs) - idx if idx >= 0 else 0
    parts.append(f"job{job_number}")
    # Sanitize: keep only alphanumeric, hyphens, underscores
    safe = "_".join(re.sub(r"[^\w\-]", "_", p) for p in parts)
    return f"{safe}_code.zip"


class ExportRequest(BaseModel):
    export_type: Literal["model", "report"]  # noqa: UP035
    output_path: str


@router.post("/{job_id}/export", response_model=ExportJobResponse)
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
        raise ExportError(str(exc)) from exc


@router.get("/{job_id}/export-code", response_model=ExportCodeResponse)
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
    filename = _build_export_filename(job, job_store)
    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=filename,
    )


# H-0062 cleanup: retune / resume / lineage endpoints live in
# ``api/retune.py`` which imports this module's ``router`` and registers
# its handlers via the same ``@router.post(...)`` decorators. Importing
# the module here ensures the registration side effect runs whenever
# ``api.jobs`` is loaded, so ``server.py`` only needs to include
# ``jobs.router`` once (URL paths are unchanged).
from lizystudio.api import retune as _retune  # noqa: E402, F401
