"""Jobs API router (BLUEPRINT §5.3).

Covers: list, get, config, metrics, split-summary, importance, plot, plots,
export, delete.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict
from typing import Any, Literal  # noqa: UP035

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from lizystudio.api.deps import get_broadcaster
from lizystudio.api.errors import (
    BackendError,
    ExportError,
    JobNotCompletedError,
    JobNotFoundError,
    JobRunningError,
    ParentHasActiveChildrenError,
    PlotNotAvailableError,
    StudioError,
    WorkspaceNoDataError,
)
from lizystudio.api.models import (
    CancelJobResponse,
    DeleteJobResponse,
    ExportCodeResponse,
    ExportJobResponse,
    JobDetailResponse,
    JobLogResponse,
    JobSummaryResponse,
    PauseJobResponse,
    PlotResponseModel,
    UnpauseJobResponse,
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
from lizystudio.services.training import start_tune_async
from lizystudio.services.workspace import WorkspaceState, get_workspace
from lizystudio.ws.progress import ProgressBroadcaster

_MAX_METRICS = 20
_VALID_PARAM_RE = re.compile(r"^[a-zA-Z0-9_]+$")

# P-0097: hard cap on the JSON-serialised importance payload. When the
# unbounded response would exceed this many bytes the route falls back
# to a top-N projection sized to fit and surfaces the truncation via
# the ``X-Truncated-By`` response header. 5MB matches the
# v0.4-business-readiness-plan §6 transfer budget.
IMPORTANCE_PAYLOAD_LIMIT = 5 * 1024 * 1024

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

    # H-0062 / P-0099 v3-20c: guard against orphaning in-flight or paused
    # children on a non-cascade delete. Collect the direct active
    # descendants first so the error details list exactly what would be
    # lost. ``paused`` joins ``pending`` / ``running`` here because a
    # paused tune still holds the workspace slot and owns the Optuna
    # sqlite that feeds /unpause.
    if not cascade and job_store.has_active_children(job_id):
        active: list[str] = []
        for cid in job_store.get_child_job_ids(job_id):
            child = job_store.get(cid)
            if child is not None and child.status in ("pending", "running", "paused"):
                active.append(cid)
        raise ParentHasActiveChildrenError(job_id, active)

    if cascade:
        # Active running/pending children must be asked to stop before we
        # rmtree their directories. Cancel flags are best-effort; the
        # actual subprocess may still be running when rmtree fires, but
        # the run_tune wrapper tolerates a missing job dir via its finally
        # block.  Paused children have no worker to observe a cancel
        # flag, so the slot is released directly here (P-0099 v3-20c) —
        # status persistence is skipped because the job dir is rmtree'd
        # immediately below.
        for cid in job_store.get_child_job_ids(job_id):
            child = job_store.get(cid)
            if child is None:
                continue
            if child.status in ("pending", "running"):
                job_store.request_cancel(cid)
            elif child.status == "paused":
                job_store.release_active(cid)
                job_store.clear_pause(cid)
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
    """Cancel a running or paused job (H-0011, P-0099 v3-20c).

    For ``running`` jobs the cancel signal is delivered via the cancel
    flag and the cooperative callback (cancel-aware-cb) unwinds through
    :class:`CancelledError` — the worker's finally-block writes
    ``status="cancelled"`` and releases the slot.

    For ``paused`` jobs there is no worker to observe a flag, so the
    transition is performed directly here: ``paused -> cancelled`` is a
    legal edge per :data:`LEGAL_TRANSITIONS`, and we explicitly release
    the slot + clear the pause flag so the workspace is unblocked
    immediately (case 案 a in P-0099 §6 — paused-as-zombie is worse UX
    than just letting Cancel be a fast exit).
    """
    job = _get_job_or_404(job_id, job_store)
    if job.status == "running":
        job_store.request_cancel(job_id)
        return {"status": "cancelled"}
    if job.status == "paused":
        # Direct transition: no worker observing the flag, so the
        # worker-side terminal write that normally rides on the cancel
        # flag will never fire.
        job_store.set_status(job_id, "cancelled")
        job_store.release_active(job_id)
        job_store.clear_pause(job_id)
        return {"status": "cancelled"}
    raise StudioError(
        "JOB_NOT_RUNNING",
        f"Job {job_id} is not running or paused (status: {job.status})",
        400,
    )


# --- Pause / Unpause (P-0099 v3-20d, R-1.4 / Issue #360) ---


@router.post("/{job_id}/pause", response_model=PauseJobResponse)
def pause_job(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, str]:
    """Request a tune job to pause at the next cooperative-cb boundary.

    Pause is a tune-only action — fit jobs are short-running by design
    (training a single model with the user's chosen params), so a pause
    primitive there has no usable resume target. The cooperative
    callback inside the worker observes the on-disk PAUSE flag through
    :meth:`JobStore.is_pause_requested` and unwinds via
    :class:`PausedError`. ``_run_job_core`` writes ``status="paused"``
    on disk and KEEPS slot ownership so the user's subsequent /unpause
    click resumes the same job in place (P-0099 v3-20c invariant).
    """
    job = _get_job_or_404(job_id, job_store)
    if job.job_type != "tune":
        raise StudioError(
            "JOB_NOT_PAUSEABLE",
            f"Pause is only available on tune jobs (job_type: {job.job_type})",
            400,
        )
    if job.status != "running":
        raise StudioError(
            "JOB_NOT_RUNNING",
            f"Pause requires a running job (status: {job.status})",
            400,
        )
    job_store.request_pause(job_id)
    return {"status": "pause_requested"}


@router.post("/{job_id}/unpause", response_model=UnpauseJobResponse)
def unpause_job(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
    broadcaster: ProgressBroadcaster = Depends(get_broadcaster),
) -> dict[str, str]:
    """Re-launch a paused tune in place (P-0099 v3-20d, R-1.4).

    Unlike ``POST /resume`` (H-0062 Phase B, failed→child job), unpause
    re-uses the SAME ``job_id``: the worker re-attaches to the same
    Optuna study via ``load_if_exists=True`` and continues from
    ``trial N+1``.  Slot ownership stays with the original job_id from
    paused into running (paused→running is a legal INV-3 transition),
    so the active-slot lock is never released across the round-trip.

    Workspace dataframe must still be loaded and matching the job's
    original ``data_ref``; mismatched data would silently corrupt the
    Optuna study (best_value compared across different data).
    """
    job = _get_job_or_404(job_id, job_store)
    if job.job_type != "tune":
        raise StudioError(
            "JOB_NOT_PAUSEABLE",
            f"Unpause is only available on tune jobs (job_type: {job.job_type})",
            400,
        )
    if job.status != "paused":
        raise StudioError(
            "JOB_NOT_PAUSED",
            f"Unpause requires a paused job (status: {job.status})",
            400,
        )
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()

    # Clear the pause flag BEFORE re-launching so the cb does not
    # immediately raise PausedError again on its first observation.
    job_store.clear_pause(job_id)

    start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=broadcaster,
        config=job.config,
        dataframe=ws.dataframe,
        job=job,
    )
    return {"status": "unpause_started", "job_id": job_id}


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
    response: Response,
    kind: str = "split",
    top_n: int | None = Query(default=None, ge=1, le=20000),
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, float]:
    """Get feature importance.

    ``top_n`` (P-0097) lets the SPA opt in to a value-desc-sorted
    projection without an extra round-trip. When the unbounded payload
    would exceed :data:`IMPORTANCE_PAYLOAD_LIMIT`, the route falls back
    to a server-side top-N projection sized to fit and surfaces the
    truncation via the ``X-Truncated-By`` response header so the SPA
    can render an honest "showing top N of M" notice.
    """
    job = _get_job_or_404(job_id, job_store)
    _require_completed(job)
    try:
        result = get_importance(
            job, ws.backend, job_store.model_cache, kind=kind, top_n=top_n
        )
    except Exception as exc:
        raise BackendError(exc) from exc

    # Server-side payload cap. If the user asked for a specific top_n
    # the route honours it silently above; the cap below only fires
    # when the unbounded response would exceed the transfer budget.
    if top_n is None and len(json.dumps(result)) > IMPORTANCE_PAYLOAD_LIMIT:
        capped = _cap_importance_payload(result, IMPORTANCE_PAYLOAD_LIMIT)
        response.headers["X-Truncated-By"] = f"top_n={len(capped)}"
        return capped
    return result


def _cap_importance_payload(
    raw: dict[str, float], limit_bytes: int
) -> dict[str, float]:
    """Return the longest top-N prefix of ``raw`` whose JSON encoding
    fits within ``limit_bytes``. Sorted value-desc so the returned
    subset is always the most informative slice. Always returns at
    least one entry (the single highest-importance feature) so the
    SPA can render *something* even at extreme cap pressure.
    """
    items = sorted(raw.items(), key=lambda kv: kv[1], reverse=True)
    # Binary search the largest prefix whose JSON dump fits.
    lo, hi = 1, len(items)
    best = 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if len(json.dumps(dict(items[:mid]))) <= limit_bytes:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return dict(items[:best])


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
