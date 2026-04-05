"""Backend API router (BLUEPRINT §5.6, H-0014)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from lizystudio.api.models import BackendInfoResponse

router = APIRouter()


@router.get("", response_model=list[BackendInfoResponse])
def list_backends(request: Request) -> list[dict[str, Any]]:
    """Return available backends."""
    backend = request.app.state.workspace.backend
    info = backend.info
    return [{"name": info.name, "version": info.version}]


@router.get("/ui-schema")
def get_ui_schema(request: Request) -> dict[str, Any]:
    """Return UI metadata for the current backend (H-0026)."""
    backend = request.app.state.workspace.backend
    return backend.get_ui_schema()  # type: ignore[no-any-return]
