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


class JobConflictError(StudioError):
    def __init__(self, job_id: str) -> None:
        super().__init__(
            "JOB_CONFLICT",
            f"A job is already running: {job_id}",
            409,
        )


class WorkspaceLockedError(StudioError):
    """Config write rejected because a fit/tune job is currently running.

    P-0089 / Issue #279: while a job holds the active slot, mutating
    ``ws.config`` would let cross-hook competing writes (CV strategy
    radio, Folds NumberInput, target/task RadioGroup) corrupt the
    config that the job's checkpoint and meta.json were created with.
    The lock is released as soon as the job transitions to a terminal
    status (``completed`` / ``failed`` / ``cancelled``) and the
    runner's finally block calls ``release_active``.
    """

    def __init__(self, job_id: str) -> None:
        super().__init__(
            "WORKSPACE_LOCKED",
            f"Config is locked while job {job_id} is running",
            409,
            details={"job_id": job_id},
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


class PlotNotAvailableError(StudioError):
    """HTTP 404 envelope for an unsupported plot type (Issue #355).

    Translated from
    :class:`lizystudio.backends.exceptions.PlotNotAvailableError` by
    the inference and jobs plot endpoints. The structured ``details``
    payload lets the client recover (e.g. fall back to a different
    plot, or hide the accordion) instead of treating this like a
    real backend failure.
    """

    def __init__(self, plot_type: str, available: list[str]) -> None:
        super().__init__(
            "PLOT_NOT_AVAILABLE",
            f"Plot type {plot_type!r} is not available (available: {available})",
            404,
            details={"plot_type": plot_type, "available": list(available)},
        )


class ConfigBuildError(StudioError):
    """Config assembly failed (e.g. missing required fields) (H-0041)."""

    def __init__(self, reason: str) -> None:
        super().__init__("CONFIG_BUILD_ERROR", f"Config build failed: {reason}", 400)


class ConfigImportError(StudioError):
    """YAML/JSON parsing or structural error during config import (H-0041)."""

    def __init__(self, reason: str) -> None:
        super().__init__("CONFIG_IMPORT_ERROR", f"Config import failed: {reason}", 400)


class ExportError(StudioError):
    """Model or report export failure (H-0041)."""

    def __init__(self, reason: str) -> None:
        super().__init__("EXPORT_ERROR", f"Export failed: {reason}", 500)


class InvalidPatchError(StudioError):
    """Invalid config patch operation (H-0037)."""

    def __init__(self, reason: str) -> None:
        super().__init__("INVALID_PATCH", f"Invalid patch: {reason}", 422)


# --- H-0062 Phase B (Re-tune / Resume) ------------------------------------


class PicklePreflightFailedError(StudioError):
    """Pre-flight pickle check failed before tune could start (H-0062)."""

    def __init__(self, reason: str) -> None:
        super().__init__(
            "PICKLE_PREFLIGHT_FAILED",
            f"Pickle preflight failed: {reason}",
            400,
        )


class PickleIncompatibleError(StudioError):
    """Stored checkpoint cannot be deserialized by the current runtime (H-0062).

    P-0107 (v3-26c): the JSON ``details`` payload carries a structured
    classification (``kind``) plus user-facing ``recovery_hint`` and
    ``suggested_fix`` strings so the frontend can render an actionable
    error toast / banner instead of just the raw ``message``.

    Backward compatibility: when the optional fields are not provided
    (legacy raise sites, future call sites that lack classification),
    ``details`` still contains ``kind="unknown"`` and the hint/fix slots
    are absent — older clients that only consume ``code`` + ``message``
    are unaffected.
    """

    def __init__(
        self,
        reason: str,
        *,
        kind: str = "unknown",
        recovery_hint: str | None = None,
        suggested_fix: str | None = None,
    ) -> None:
        details: dict[str, Any] = {"kind": kind}
        if recovery_hint:
            details["recovery_hint"] = recovery_hint
        if suggested_fix:
            details["suggested_fix"] = suggested_fix
        super().__init__(
            "PICKLE_INCOMPATIBLE",
            f"Checkpoint incompatible: {reason}",
            400,
            details=details,
        )


class ParentLockedError(StudioError):
    """Another Re-tune / Resume is already attached to this parent (H-0062)."""

    def __init__(self, parent_job_id: str, holder_child_id: str | None) -> None:
        detail = f" (held by {holder_child_id})" if holder_child_id else ""
        super().__init__(
            "PARENT_LOCKED",
            f"Parent job {parent_job_id} already has an active retune/resume{detail}",
            409,
            details={"parent_job_id": parent_job_id, "holder": holder_child_id},
        )


class ParentHasActiveChildrenError(StudioError):
    """DELETE on a parent with active children without ?cascade=true (H-0062)."""

    def __init__(self, parent_job_id: str, active: list[str]) -> None:
        super().__init__(
            "PARENT_HAS_ACTIVE_CHILDREN",
            (
                f"Parent job {parent_job_id} has {len(active)} active child job(s). "
                "Retry with ?cascade=true to cancel and delete them together."
            ),
            409,
            details={"parent_job_id": parent_job_id, "active_children": active},
        )


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
