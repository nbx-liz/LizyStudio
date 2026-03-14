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
from fastapi import APIRouter, Depends, Request, UploadFile
from fastapi.responses import Response

import lizystudio.security as security
from lizystudio.api.errors import (
    FileInvalidError,
    PathNotFoundError,
    ValidationError,
    WorkspaceNoConfigError,
    WorkspaceNoDataError,
)
from lizystudio.security import read_upload_checked, validate_path_within
from lizystudio.services.data import (
    analyze_columns,
    get_describe,
    get_preview,
    load_dataframe,
    make_data_ref,
)
from lizystudio.services.jobs import JobStore, get_job_store
from lizystudio.services.training import start_fit_async, start_tune_async
from lizystudio.services.workspace import (
    WorkspaceState,
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


@router.get("/status")
def workspace_status(
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Return current workspace state summary.

    If current_job_id is set, attempt to restore results from JobStore
    so the frontend can recover state after a page refresh.
    """
    # Restore results from JobStore if volatile state was lost
    if ws.current_job_id and ws.workspace_fit_result is None:
        job = job_store.get(ws.current_job_id)
        if job is not None and job.status == "completed":
            ws.workspace_fit_result = job.fit_result
            ws.workspace_tune_result = job.tune_result

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


@router.post("/data/path")
def data_load_path(
    body: dict[str, Any],
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Load data from a local file path."""
    path = body.get("path", "")
    try:
        validate_path_within(Path(path), security.ALLOWED_FILES_ROOT)
    except ValueError as exc:
        raise PathNotFoundError(str(exc)) from exc
    if not Path(path).exists():
        raise PathNotFoundError(path)
    try:
        df = load_dataframe(path)
    except Exception as exc:
        raise FileInvalidError(str(exc)) from exc
    data_ref = make_data_ref(
        df, source_type="path", path=path, filename=Path(path).name
    )
    ws.set_data(df, data_ref)
    return {"data_ref": asdict(data_ref)}


@router.post("/data/upload")
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
    data_ref = make_data_ref(df, source_type="upload", path=tmp_name, filename=filename)
    ws.set_data(df, data_ref)
    ws.track_temp_file(tmp_name)
    return {"data_ref": asdict(data_ref)}


@router.get("/data/preview")
def data_preview(
    rows: int = 50,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return first N rows of loaded data."""
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    return get_preview(ws.dataframe, rows=rows)


@router.get("/data/columns")
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


@router.put("/config")
def config_update(
    body: dict[str, Any],
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Update config with validation."""
    errors = validate_config(ws, body)
    if not errors:
        ws.set_config(body)
    return {"config": body, "errors": errors, "saved": len(errors) == 0}


@router.post("/config/validate")
def config_validate(
    body: dict[str, Any],
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Validate config without saving."""
    errors = validate_config(ws, body)
    return {"valid": len(errors) == 0, "errors": errors}


@router.post("/config/upload")
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
        raise FileInvalidError(str(exc)) from exc
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


@router.post("/fit")
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
    job = job_store.create(
        backend_name=get_backend_name(ws),
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="fit",
    )
    job_id = start_fit_async(
        ws=ws,
        job_store=job_store,
        broadcaster=_get_broadcaster(request),
        config=ws.config,
        dataframe=ws.dataframe,
        job=job,
    )
    return {"job_id": job_id}


@router.post("/tune")
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
    # Inject default tuning config if not set (H-0025) — immutable copy
    if ws.config.get("tuning") is None:
        config_with_tuning = copy.deepcopy(ws.config)
        config_with_tuning["tuning"] = {
            "optuna": {
                "params": {"n_trials": 50, "direction": "minimize", "timeout": None},
                "space": {},
            }
        }
        ws.set_config(config_with_tuning)
    errors = validate_config(ws, ws.config)
    if errors:
        raise ValidationError(errors)
    job = job_store.create(
        backend_name=get_backend_name(ws),
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="tune",
    )
    job_id = start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=_get_broadcaster(request),
        config=ws.config,
        dataframe=ws.dataframe,
        job=job,
    )
    return {"job_id": job_id}
