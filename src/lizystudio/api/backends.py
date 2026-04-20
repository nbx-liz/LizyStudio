"""Backend API router (BLUEPRINT §5.6, H-0014)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from lizystudio.api.deps import get_backend
from lizystudio.api.models import BackendInfoResponse, UiSchemaResponse
from lizystudio.backends.base import BackendAdapter

router = APIRouter()


@router.get("", response_model=list[BackendInfoResponse])
def list_backends(
    backend: BackendAdapter = Depends(get_backend),
) -> list[dict[str, Any]]:
    """Return available backends."""
    info = backend.info
    return [{"name": info.name, "version": info.version}]


@router.get("/ui-schema", response_model=UiSchemaResponse)
def get_ui_schema(
    backend: BackendAdapter = Depends(get_backend),
) -> dict[str, Any]:
    """Return UI metadata for the current backend (H-0026).

    ``response_model=UiSchemaResponse`` (C-5) drives OpenAPI schema
    generation so ``frontend/src/api/types.ts`` can re-export the
    ``UiSchema`` type from ``schema.d.ts`` instead of declaring it by
    hand.
    """
    return backend.get_ui_schema()
