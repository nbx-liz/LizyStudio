"""Workspace API router (BLUEPRINT §5.2).

Covers: status, reset, data, config, fit, tune.
"""

from __future__ import annotations

import copy
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, Query, Request, UploadFile  # noqa: F401
from fastapi.responses import Response
from pydantic import BaseModel  # noqa: F401

import lizystudio.security as security
from lizystudio.api.errors import (
    ConfigImportError,
    FileInvalidError,
    InvalidPatchError,
    JobConflictError,
    PathNotFoundError,
    ValidationError,
    WorkspaceNoConfigError,
    WorkspaceNoDataError,
)
from lizystudio.api.models import (
    ColumnsResponseModel,
    ConfigPatchResponse,
    ConfigUpdateResponse,
    DataLoadResponse,
    JobStartResponse,
    PreviewResponseModel,
    SplitPreviewResponseModel,
    ValidationResponse,
    WorkspaceStatusResponse,
)
from lizystudio.security import (
    check_dataframe_memory,
    read_upload_checked,
    validate_path_within,
)
from lizystudio.services.data import (
    analyze_columns,
    compute_split_preview,
    get_column_value_counts,
    get_describe,
    get_preview,
    load_dataframe,
    make_data_ref,
)
from lizystudio.services.jobs import JobStore, get_job_store
from lizystudio.services.training import (
    PreviousJobStillRunningError,
    start_fit_async,
    start_tune_async,
)
from lizystudio.services.workspace import (
    WorkspaceState,
    apply_config_patch,
    get_backend_name,
    get_config_schema,
    get_default_config,
    get_workspace,
    load_config_from_file,
    validate_config,
)
from lizystudio.ws.progress import ProgressBroadcaster

router = APIRouter()


# --- Status / Reset ---


@router.get("/status", response_model=WorkspaceStatusResponse)
def workspace_status(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return current workspace state summary.

    Per BLUEPRINT §4.2.3: browser close = Results empty. Results are only
    available from volatile memory (set by the background job thread), never
    restored from disk.
    """
    return {
        "has_data": ws.dataframe is not None,
        "has_config": bool(ws.config),
        "has_result": ws.workspace_fit_result is not None,
        "data_ref": {
            "filename": ws.data_ref.filename,
            "shape": ws.data_ref.shape,
        }
        if ws.data_ref
        else None,
        "current_job_id": ws.current_job_id,
    }


@router.post("/reset")
def workspace_reset(ws: WorkspaceState = Depends(get_workspace)) -> dict[str, str]:
    """Reset all workspace state."""
    ws.reset()
    return {"status": "ok"}


# --- Data endpoints (BLUEPRINT §5.2 Data) ---


class DataPathRequest(BaseModel):
    path: str


@router.post("/data/path", response_model=DataLoadResponse)
def data_load_path(
    body: DataPathRequest,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Load data from a local file path.

    Uses the resolved path from ``validate_path_within`` for the
    subsequent exists / read operations so a symlink swap between the
    allow-list check and the actual load cannot redirect to a file
    outside ``ALLOWED_FILES_ROOT``.
    """
    try:
        resolved = validate_path_within(Path(body.path), security.ALLOWED_FILES_ROOT)
    except ValueError as exc:
        raise PathNotFoundError(str(exc)) from exc
    if not resolved.exists():
        raise PathNotFoundError(str(resolved))
    try:
        df = load_dataframe(str(resolved))
    except (FileNotFoundError, OSError) as exc:
        # File vanished between the exists() check and the read, or the
        # filesystem rejected the access outright.
        raise PathNotFoundError(str(resolved)) from exc
    except Exception as exc:  # noqa: BLE001 - pandas raises a wide variety
        raise FileInvalidError(str(exc)) from exc
    memory_usage_bytes = check_dataframe_memory(df)
    data_ref = make_data_ref(
        df, source_type="path", path=str(resolved), filename=resolved.name
    )
    ws.set_data(df, data_ref)
    return {"data_ref": asdict(data_ref), "memory_usage_bytes": memory_usage_bytes}


@router.post("/data/upload", response_model=DataLoadResponse)
async def data_upload(
    file: UploadFile,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Upload a CSV/Parquet file."""
    filename = file.filename or "upload"
    suffix = Path(filename).suffix
    if suffix not in (".csv", ".parquet"):
        raise FileInvalidError(f"Unsupported file type: {suffix}. Use .csv or .parquet")
    try:
        content = await read_upload_checked(file)
    except ValueError as exc:
        raise FileInvalidError(str(exc)) from exc
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, prefix="lizystudio_"
    ) as tmp:
        tmp.write(content)
        tmp_name = tmp.name
    try:
        df = load_dataframe(tmp_name)
    except Exception as exc:
        Path(tmp_name).unlink(missing_ok=True)
        raise FileInvalidError(str(exc)) from exc
    try:
        memory_usage_bytes = check_dataframe_memory(df)
    except FileInvalidError:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    data_ref = make_data_ref(df, source_type="upload", path=tmp_name, filename=filename)
    ws.set_data(df, data_ref)
    ws.track_temp_file(tmp_name)
    return {"data_ref": asdict(data_ref), "memory_usage_bytes": memory_usage_bytes}


@router.get("/data/preview", response_model=PreviewResponseModel)
def data_preview(
    rows: int = Query(default=50, ge=1, le=10000),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return first N rows of loaded data."""
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    return get_preview(ws.dataframe, rows=rows)


@router.get("/data/columns", response_model=ColumnsResponseModel)
def data_columns(
    target: str | None = None,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return column analysis with auto-detection (BLUEPRINT §4.2.1)."""
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    result = analyze_columns(ws.dataframe, target=target)
    return asdict(result)


@router.get("/data/describe")
def data_describe(
    ws: WorkspaceState = Depends(get_workspace),
) -> list[dict[str, Any]]:
    """Return descriptive statistics for all columns."""
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    return get_describe(ws.dataframe)


@router.get("/data/column-stats/{col}")
def data_column_stats(
    col: str,
    top_n: int = 20,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return value distribution for a single column (H-0046)."""
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    try:
        stats = get_column_value_counts(ws.dataframe, col, top_n=top_n)
    except KeyError as exc:
        raise PathNotFoundError(str(exc)) from exc
    return asdict(stats)


@router.get("/data/split-preview", response_model=SplitPreviewResponseModel)
def data_split_preview(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return approximate fold sizes for the current CV split config.

    Computes sizes arithmetically from n_rows and config — no sklearn needed.
    Requires both data and config (with ``split.method`` and ``split.n_splits``)
    to be set in the workspace.
    """
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    if not ws.config:
        raise WorkspaceNoConfigError()
    split_cfg = ws.config.get("split", {})
    strategy = split_cfg.get("method", "")
    n_splits = split_cfg.get("n_splits", 5)
    gap = split_cfg.get("gap", 0)
    max_train_size = split_cfg.get("max_train_size")
    max_test_size = split_cfg.get("max_test_size")
    n_rows = len(ws.dataframe)
    preview = compute_split_preview(
        n_rows,
        strategy,
        n_splits,
        gap=gap,
        max_train_size=max_train_size,
        max_test_size=max_test_size,
    )
    return asdict(preview)


# --- Config endpoints (BLUEPRINT §5.2 Config) ---


@router.get("/config/schema")
def config_schema(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return the backend's config JSON Schema."""
    return get_config_schema(ws)


@router.get("/config/defaults")
def config_defaults(
    task: str,
    target: str,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return a complete default config for the given task and target."""
    return get_default_config(ws, task, target)


@router.get("/config")
def config_get(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return the current workspace config."""
    return ws.config


@router.put("/config", response_model=ConfigUpdateResponse)
def config_update(
    body: dict[str, Any],
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Update config with validation."""
    errors = validate_config(ws, body)
    if not errors:
        ws.set_config(body)
    return {"config": body, "errors": errors, "saved": len(errors) == 0}


@router.patch("/config", response_model=ConfigPatchResponse)
def config_patch(
    body: dict[str, Any],
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Partially update config via patch operations (H-0037)."""
    if not ws.config:
        raise WorkspaceNoConfigError()
    ops = body.get("ops", [])
    if not isinstance(ops, list):
        raise InvalidPatchError("'ops' must be a list")
    try:
        patched = apply_config_patch(ws.config, ops)
    except ValueError as exc:
        raise InvalidPatchError(str(exc)) from exc
    ws.set_config(patched)
    return {"config": patched}


@router.post("/config/validate", response_model=ValidationResponse)
def config_validate(
    body: dict[str, Any] | None = None,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Validate config without saving.

    If no body is provided, validates the current workspace config.
    """
    config = body if body is not None else ws.config
    if not config:
        raise WorkspaceNoConfigError()
    errors = validate_config(ws, config)
    return {"valid": len(errors) == 0, "errors": errors}


@router.post("/config/upload", response_model=ConfigUpdateResponse)
async def config_upload(
    file: UploadFile,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Load config from an uploaded YAML/JSON file."""
    try:
        content = await read_upload_checked(file)
    except ValueError as exc:
        raise FileInvalidError(str(exc)) from exc
    filename = file.filename or "config.yaml"
    try:
        config = load_config_from_file(ws, content, filename)
    except Exception as exc:
        raise ConfigImportError(str(exc)) from exc
    errors = validate_config(ws, config)
    if not errors:
        ws.set_config(config)
    return {"config": config, "errors": errors, "saved": len(errors) == 0}


@router.get("/config/download")
def config_download(
    ws: WorkspaceState = Depends(get_workspace),
) -> Response:
    """Download the current config as YAML."""
    if not ws.config:
        raise WorkspaceNoConfigError()
    content = yaml.dump(ws.config, default_flow_style=False, allow_unicode=True)
    return Response(
        content=content,
        media_type="application/x-yaml",
        headers={"Content-Disposition": "attachment; filename=config.yaml"},
    )


# --- Helpers ---


def _get_broadcaster(request: Request) -> ProgressBroadcaster:
    return request.app.state.broadcaster  # type: ignore[no-any-return]


# --- Fit / Tune endpoints (BLUEPRINT §5.2 Fit/Tune) ---


@router.post("/fit", response_model=JobStartResponse)
def workspace_fit(
    request: Request,
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Create a fit job (thread managed by Service layer)."""
    if not ws.config:
        raise WorkspaceNoConfigError()
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()
    errors = validate_config(ws, ws.config)
    if errors:
        raise ValidationError(errors)
    # CRITICAL-2: atomically claim the active slot and create the job
    # metadata in a single critical section so two concurrent
    # /fit requests cannot race past the has_active_job check and
    # leave an orphan "failed" job on disk.
    job = job_store.create_and_claim_active(
        backend_name=get_backend_name(ws),
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="fit",
    )
    if job is None:
        raise JobConflictError(job_store.active_job_id or "unknown")
    try:
        job_id = start_fit_async(
            ws=ws,
            job_store=job_store,
            broadcaster=_get_broadcaster(request),
            config=ws.config,
            dataframe=ws.dataframe,
            job=job,
        )
    except PreviousJobStillRunningError:
        job.status = "failed"
        job.error = "Previous job still running"
        job_store.update(job)
        job_store.release_active(job.job_id)
        raise JobConflictError(job.job_id) from None
    except Exception:
        # Any other failure after we claimed the slot must release it,
        # otherwise the slot stays held until server restart.
        job_store.release_active(job.job_id)
        raise
    return {"job_id": job_id}


@router.post("/tune", response_model=JobStartResponse)
def workspace_tune(
    request: Request,
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Create a tune job (thread managed by Service layer)."""
    if not ws.config:
        raise WorkspaceNoConfigError()
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()
    # Inject default tuning config if not set (H-0025) — immutable copy.
    #
    # Direction is intentionally NOT hardcoded here (Bug 2026-04-14): a
    # ``minimize`` default would override the AUC / R2 / accuracy class
    # of metrics that should be maximized, and ``_prepare_tune_config``'s
    # auto-resolve was guarded by ``"direction" not in params`` so the
    # wrong value silently propagated to Optuna. The auto-resolve in
    # ``_prepare_tune_config`` is now the single source of truth — it
    # reads ``evaluation.metrics`` and picks ``maximize`` / ``minimize``
    # from the maximize-set table. Leaving direction unset here lets that
    # resolver fire on every fresh tune.
    if ws.config.get("tuning") is None:
        config_with_tuning = copy.deepcopy(ws.config)
        config_with_tuning["tuning"] = {
            "optuna": {
                "params": {"n_trials": 50, "timeout": None},
                "space": {},
            }
        }
        ws.set_config(config_with_tuning)
    errors = validate_config(ws, ws.config)
    if errors:
        raise ValidationError(errors)
    # CRITICAL-2: atomic create + slot claim, see workspace_fit above.
    job = job_store.create_and_claim_active(
        backend_name=get_backend_name(ws),
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="tune",
    )
    if job is None:
        raise JobConflictError(job_store.active_job_id or "unknown")
    try:
        job_id = start_tune_async(
            ws=ws,
            job_store=job_store,
            broadcaster=_get_broadcaster(request),
            config=ws.config,
            dataframe=ws.dataframe,
            job=job,
        )
    except PreviousJobStillRunningError:
        job.status = "failed"
        job.error = "Previous job still running"
        job_store.update(job)
        job_store.release_active(job.job_id)
        raise JobConflictError(job.job_id) from None
    except Exception:
        job_store.release_active(job.job_id)
        raise
    return {"job_id": job_id}
