"""Workspace API router (BLUEPRINT §5.2).

Covers: status, reset, data endpoints. Config/Fit/Tune added in later phases.
"""

from __future__ import annotations

import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, UploadFile

from lizystudio.api.errors import (
    FileInvalidError,
    PathNotFoundError,
    WorkspaceNoDataError,
)
from lizystudio.services.data import (
    analyze_columns,
    get_describe,
    get_preview,
    load_dataframe,
    make_data_ref,
)
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
