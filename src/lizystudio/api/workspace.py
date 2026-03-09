"""Workspace API router — status, reset, and stubs for data/config/fit/tune.

Full data and config endpoints are implemented in Phase 3–4.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from lizystudio.services.workspace import WorkspaceState, get_workspace

router = APIRouter()


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
