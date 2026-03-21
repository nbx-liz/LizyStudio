"""Structured error types and FastAPI exception handlers (BLUEPRINT §6.1)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

_backend_logger = logging.getLogger("lizystudio.errors")


class StudioError(Exception):
    """Base error for all LizyStudio domain errors."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


# --- Concrete errors ---


class WorkspaceNoConfigError(StudioError):
    def __init__(self) -> None:
        super().__init__("WORKSPACE_NO_CONFIG", "No config set in workspace", 400)


class WorkspaceNoDataError(StudioError):
    def __init__(self) -> None:
        super().__init__("WORKSPACE_NO_DATA", "No data loaded in workspace", 400)


class JobNotFoundError(StudioError):
    def __init__(self, job_id: str) -> None:
        super().__init__("JOB_NOT_FOUND", f"Job not found: {job_id}", 404)


class JobNotCompletedError(StudioError):
    def __init__(self, job_id: str) -> None:
        super().__init__("JOB_NOT_COMPLETED", f"Job not completed: {job_id}", 400)


class JobRunningError(StudioError):
    def __init__(self, job_id: str) -> None:
        super().__init__(
            "JOB_RUNNING",
            f"Cannot delete a running job: {job_id}",
            400,
        )


class ValidationError(StudioError):
    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__(
            "VALIDATION_ERROR",
            "Config validation failed",
            422,
            details={"errors": errors},
        )


class FileInvalidError(StudioError):
    def __init__(self, reason: str) -> None:
        super().__init__("FILE_INVALID", f"Invalid file: {reason}", 400)


class PathNotFoundError(StudioError):
    def __init__(self, path: str) -> None:
        super().__init__("PATH_NOT_FOUND", f"Path not found: {path}", 400)


class BackendError(StudioError):
    def __init__(self, original: Exception) -> None:
        _backend_logger.exception("Backend error", exc_info=original)
        super().__init__(
            "BACKEND_ERROR",
            f"Backend processing failed: {type(original).__name__}",
            500,
            details={"type": type(original).__name__},
        )


class InferenceNotFoundError(StudioError):
    def __init__(self, inf_id: str) -> None:
        super().__init__("INFERENCE_NOT_FOUND", f"Inference not found: {inf_id}", 404)


# --- FastAPI exception handlers ---


async def studio_error_handler(_request: Request, exc: StudioError) -> JSONResponse:
    """Convert StudioError to the standard JSON envelope."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            }
        },
    )


async def validation_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Convert FastAPI RequestValidationError to the standard JSON envelope (H-0007)."""
    from fastapi.exceptions import RequestValidationError

    errors: list[Any] = []
    if isinstance(exc, RequestValidationError):
        errors = exc.errors()  # type: ignore[assignment]
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": {"errors": errors},
            }
        },
    )
