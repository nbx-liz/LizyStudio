"""Config management API."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/schema")
async def get_schema() -> dict[str, object]:
    """Return the LizyML config JSON schema for form generation."""
    from lizyml.config.schema import LizyMLConfig

    return LizyMLConfig.model_json_schema()


@router.post("/validate")
async def validate_config(config: dict[str, object]) -> dict[str, object]:
    """Validate a config dict against the LizyML schema."""
    from pydantic import ValidationError

    from lizyml.config.schema import LizyMLConfig

    try:
        LizyMLConfig.model_validate(config)
        return {"valid": True, "errors": []}
    except ValidationError as e:
        return {"valid": False, "errors": e.errors()}
