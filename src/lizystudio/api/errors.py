"""Structured error types and FastAPI exception handlers (BLUEPRINT §6.1)."""

from __future__ import annotations

import logging
from http import HTTPStatus
from typing import TYPE_CHECKING, Any

from fastapi import Request
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    from lizystudio.backends.exceptions import (
        BackendArtifactError,
        BackendInputError,
        BackendRefusalError,
        CheckpointIncompatibleError,
    )
    from lizystudio.backends.exceptions import (
        RefitRequiredError as BackendRefitRequiredError,
    )

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
    """Blocking config validation (422).

    Under ``/api/workspace/**`` the entries travel as the RFC 9457
    ``validation_errors`` extension member (P-0110); elsewhere they stay
    in the legacy ``error.details.errors``.
    """

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__(
            "VALIDATION_ERROR",
            "Config validation failed",
            422,
            details={"errors": errors},
        )
        self.validation_errors = list(errors)


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


class BackendInputRejectedError(StudioError):
    """HTTP 400 envelope for data the backend refused (P-0117 D2)."""

    def __init__(self, exc: BackendInputError) -> None:
        super().__init__(
            exc.code,
            exc.message,
            400,
            details=_refusal_details(exc),
        )


class ModelArtifactInvalidError(StudioError):
    """HTTP 409 envelope for a stored model the backend cannot read (P-0117 D2)."""

    def __init__(self, exc: BackendArtifactError) -> None:
        super().__init__(
            exc.code,
            exc.message,
            409,
            details=_refusal_details(exc),
        )


def _refusal_details(exc: BackendRefusalError) -> dict[str, Any]:
    return {
        "backend_code": exc.backend_code,
        "reason": exc.reason,
        "recovery_hint": exc.remedy,
        "context": dict(exc.context),
    }


def backend_error_from(exc: Exception) -> StudioError:
    """The HTTP envelope for a backend failure (P-0117 D2).

    A refusal the adapter classified keeps its code, reason and remedy
    (400 for refused data, 409 for an unreadable model); every other
    failure stays 500 ``BACKEND_ERROR``.
    """
    from lizystudio.backends.exceptions import (
        BackendArtifactError,
        BackendInputError,
    )

    if isinstance(exc, BackendInputError):
        return BackendInputRejectedError(exc)
    if isinstance(exc, BackendArtifactError):
        return ModelArtifactInvalidError(exc)
    return BackendError(exc)


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


class RefitRequiredError(StudioError):
    """HTTP 400 envelope for a stored model that needs a new Fit (P-0116 D4).

    Translated from :class:`lizystudio.backends.exceptions.RefitRequiredError`
    by the importance, plot and export-code endpoints: a model written by an
    older backend version lacks what the operation needs (``kind``), and only
    a new Fit with the current version restores it.
    """

    def __init__(self, reason: str, *, kind: str, names: tuple[str, ...] = ()) -> None:
        super().__init__(
            "REFIT_REQUIRED",
            reason,
            400,
            details={
                "kind": kind,
                "names": list(names),
                "recovery_hint": "Fit the model again with the current version",
            },
        )


def refit_required_from(exc: BackendRefitRequiredError) -> RefitRequiredError:
    """The HTTP envelope for a backend's refit refusal (P-0116 D4)."""
    return RefitRequiredError(str(exc), kind=exc.kind, names=exc.names)


class ConfigBuildError(StudioError):
    """Config assembly failed (e.g. missing required fields) (H-0041)."""

    def __init__(self, reason: str) -> None:
        super().__init__("CONFIG_BUILD_ERROR", f"Config build failed: {reason}", 400)


class ConfigImportError(StudioError):
    """YAML/JSON parsing or structural error during config import (H-0041)."""

    def __init__(self, reason: str) -> None:
        super().__init__("CONFIG_IMPORT_ERROR", f"Config import failed: {reason}", 400)


class ExportError(StudioError):
    """Unclassified model or report export failure (H-0041, P-0121).

    The message carries only the exception type name; the exception's own
    text can hold the user's data values or local paths, so it is logged on
    the server instead.
    """

    def __init__(self, original: Exception) -> None:
        _backend_logger.exception("Export failed", exc_info=original)
        super().__init__(
            "EXPORT_ERROR",
            f"Export failed ({type(original).__name__})",
            500,
            details={},
        )


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


def pickle_incompatible_from(
    subject: str, exc: CheckpointIncompatibleError
) -> PickleIncompatibleError:
    """The HTTP envelope for a backend's checkpoint refusal (P-0107, P-0116 D4).

    Forwards the backend's structured classification so the frontend can
    render a kind-specific recovery hint instead of a raw message.
    """
    return PickleIncompatibleError(
        f"{subject}: {exc}",
        kind=exc.kind,
        recovery_hint=exc.recovery_hint,
        suggested_fix=exc.suggested_fix,
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


# --- RFC 9457 Problem Details (P-0110) ---

PROBLEM_JSON_MEDIA_TYPE = "application/problem+json"

# P-0110 scope: only the workspace router answers with Problem Details.
# The jobs / inference / files routers keep the legacy ``{"error": {...}}``
# envelope until a later Proposal moves them.
_PROBLEM_DETAILS_PREFIX = "/api/workspace"


def wants_problem_details(path: str) -> bool:
    """True when *path* is ``/api/workspace`` or below it.

    The prefix is anchored at a path-segment boundary so that a sibling
    such as ``/api/workspaces`` does not match.
    """
    return path == _PROBLEM_DETAILS_PREFIX or path.startswith(
        _PROBLEM_DETAILS_PREFIX + "/"
    )


def _status_phrase(status_code: int) -> str:
    """The HTTP reason phrase RFC 9457 asks for when ``type`` is about:blank."""
    try:
        return HTTPStatus(status_code).phrase
    except ValueError:
        # A non-standard status has no registered phrase; RFC 9457 only
        # says SHOULD, so fall back to a neutral title instead of a 500.
        return "Error"


def problem_details_body(exc: StudioError) -> dict[str, Any]:
    """Serialize *exc* as an RFC 9457 Problem Details object (P-0110).

    ``type`` is ``about:blank`` (Decision Q2), so ``title`` is the HTTP
    reason phrase and the problem is identified by the ``code``
    extension member. ``details`` keeps the existing structured payload
    (``job_id``, ``recovery_hint``...). A :class:`ValidationError` moves
    its entries to the ``validation_errors`` member (Decision Q3).
    """
    details = dict(exc.details)
    validation_errors: list[dict[str, Any]] | None = None
    if isinstance(exc, ValidationError):
        details.pop("errors", None)
        validation_errors = list(exc.validation_errors)
    # Every member is always present (``validation_errors`` is null on a
    # non-validation problem) so the body matches the ``ProblemDetails``
    # OpenAPI schema field for field.
    return {
        "type": "about:blank",
        "title": _status_phrase(exc.status_code),
        "status": exc.status_code,
        "detail": exc.message,
        "code": exc.code,
        "details": details,
        "validation_errors": validation_errors,
    }


# --- FastAPI exception handlers ---


async def studio_error_handler(request: Request, exc: StudioError) -> JSONResponse:
    """Convert StudioError to its HTTP error body.

    Under ``/api/workspace/**`` the body is RFC 9457 Problem Details
    (``application/problem+json``, P-0110); every other router keeps the
    legacy ``{"error": {code, message, details}}`` envelope.

    Also emits a WARNING-level log line (Issue #513) so 4xx domain
    errors are visible to operators after the fact. ``details`` is
    deliberately excluded from the WARNING channel because it can
    carry user-supplied input (paths, validation snippets).
    """
    _backend_logger.warning(
        "StudioError %s (%d) at %s %s",
        exc.code,
        exc.status_code,
        request.method,
        request.url.path,
    )
    if wants_problem_details(request.url.path):
        return JSONResponse(
            status_code=exc.status_code,
            content=problem_details_body(exc),
            media_type=PROBLEM_JSON_MEDIA_TYPE,
        )
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
