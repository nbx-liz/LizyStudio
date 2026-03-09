"""Workspace API router (BLUEPRINT §5.2).

Covers: status, reset, data, config, fit, tune.
"""

from __future__ import annotations

import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import Response

from lizystudio.api.errors import (
    BackendError,
    FileInvalidError,
    PathNotFoundError,
    WorkspaceNoConfigError,
    WorkspaceNoDataError,
)
from lizystudio.services.data import (
    analyze_columns,
    get_describe,
    get_preview,
    load_dataframe,
    make_data_ref,
)
from lizystudio.services.jobs import JobStore, get_job_store
from lizystudio.services.training import run_fit, run_tune
from lizystudio.services.workspace import WorkspaceState, get_workspace

router = APIRouter()


# --- Status / Reset ---


@router.get("/status")
def workspace_status(ws: WorkspaceState = Depends(get_workspace)) -> dict[str, Any]:
    """Return current workspace state summary."""
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
    content = await file.read()
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, prefix="lizystudio_"
    ) as tmp:
        tmp.write(content)
        tmp_name = tmp.name
    try:
        df = load_dataframe(tmp_name)
    except Exception as exc:
        raise FileInvalidError(str(exc)) from exc
    data_ref = make_data_ref(df, source_type="upload", path=tmp_name, filename=filename)
    ws.set_data(df, data_ref)
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
    schema = ws.backend.get_config_schema()
    return schema.json_schema


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
    errors = ws.backend.validate_config(body)
    ws.set_config(body)
    return {"config": body, "errors": errors}


@router.post("/config/validate")
def config_validate(
    body: dict[str, Any],
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Validate config without saving."""
    errors = ws.backend.validate_config(body)
    return {"valid": len(errors) == 0, "errors": errors}


@router.post("/config/upload")
async def config_upload(
    file: UploadFile,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Load config from an uploaded YAML/JSON file."""
    content = await file.read()
    filename = file.filename or "config.yaml"
    try:
        config = ws.backend.load_config_from_file(content, filename)
    except Exception as exc:
        raise FileInvalidError(str(exc)) from exc
    errors = ws.backend.validate_config(config)
    ws.set_config(config)
    return {"config": config, "errors": errors}


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


# --- Fit / Tune endpoints (BLUEPRINT §5.2 Fit/Tune) ---


@router.post("/fit")
def workspace_fit(
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Create and run a fit job with current config + data."""
    if not ws.config:
        raise WorkspaceNoConfigError()
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()
    job = job_store.create(
        backend_name=ws.backend.info.name,
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="fit",
    )
    try:
        job = run_fit(
            job=job,
            job_store=job_store,
            backend=ws.backend,
            config=ws.config,
            dataframe=ws.dataframe,
        )
    except Exception as exc:
        raise BackendError(exc) from exc
    # Update workspace volatile state
    ws.workspace_fit_result = job.fit_result
    ws.workspace_tune_result = None
    ws.current_job_id = job.job_id
    return {"job_id": job.job_id}


@router.post("/tune")
def workspace_tune(
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Create and run a tune job with current config + data."""
    if not ws.config:
        raise WorkspaceNoConfigError()
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()
    job = job_store.create(
        backend_name=ws.backend.info.name,
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="tune",
    )
    try:
        job = run_tune(
            job=job,
            job_store=job_store,
            backend=ws.backend,
            config=ws.config,
            dataframe=ws.dataframe,
        )
    except Exception as exc:
        raise BackendError(exc) from exc
    # Update workspace volatile state
    ws.workspace_fit_result = job.fit_result
    ws.workspace_tune_result = job.tune_result
    ws.current_job_id = job.job_id
    return {"job_id": job.job_id}
