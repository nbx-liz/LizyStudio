"""Backend API router (BLUEPRINT §5.6, H-0014)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("")
def list_backends(request: Request) -> list[dict[str, Any]]:
    """Return available backends."""
    backend = request.app.state.workspace.backend
    info = backend.info
    return [{"name": info.name, "version": info.version}]
