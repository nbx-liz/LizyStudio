"""Workspace API router (BLUEPRINT §5.2).

Covers: status, reset, data, config, fit, tune.
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Any

import yaml
from fastapi import APIRouter, Body, Depends, Query, Request, UploadFile  # noqa: F401
from fastapi.responses import Response
from pydantic import BaseModel  # noqa: F401

import lizystudio.security as security
from lizystudio.api._lifecycle_http import launch_reserved, teardown_active_job
from lizystudio.api.deps import get_broadcaster
from lizystudio.api.errors import (
    ConfigImportError,
    FileInvalidError,
    InvalidPatchError,
    JobConflictError,
    PathNotFoundError,
    ValidationError,
    WorkspaceLockedError,
    WorkspaceNoConfigError,
    WorkspaceNoDataError,
)
from lizystudio.api.models import (
    ColumnsResponseModel,
    ConfigPatchResponse,
    ConfigUpdateResponse,
    DataLoadResponse,
    JobStartResponse,
    PreviewResponseModel,
    SplitPreviewResponseModel,
    TuningOverridesUpdateResponse,
    TuningSnapshotResponse,
    ValidationResponse,
    WorkspaceFitRequest,
    WorkspaceStatusResponse,
    WorkspaceTuneRequest,
    problem_responses,
)
from lizystudio.backends.types import TuningOverrides
from lizystudio.security import (
    check_dataframe_memory,
    read_upload_checked,
    validate_path_within,
)
from lizystudio.services.data import (
    analyze_columns,
    compute_split_preview,
    get_column_value_counts,
    get_describe,
    get_preview,
    load_dataframe,
    make_data_ref,
)
from lizystudio.services.jobs import JobStore, get_job_store
from lizystudio.services.training import (
    start_fit_async,
    start_tune_async,
)
from lizystudio.services.workspace import (
    WorkspaceState,
    absorb_legacy_tuning,
    apply_config_patch,
    get_backend_name,
    get_config_schema,
    get_default_config,
    get_legacy_config_view,
    get_tuning_snapshot,
    get_workspace,
    load_config_from_file,
    materialize_tuning_for_job,
    relaunch_rule_errors,
    update_tuning_overrides,
    validate_config,
    validate_search_space_for_tune,
)
from lizystudio.ws.progress import ProgressBroadcaster

router = APIRouter()
_log = logging.getLogger(__name__)


def _blocking_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return only ``severity="error"`` entries (#394 / PR-D1).

    PR-B4 introduced ``severity`` on validation entries; PR-C2 added
    ``severity="warning"`` advisories that must not block Fit/Tune.
    Pre-PR-B4 callers omit the field entirely, so we default missing
    values to ``"error"`` to preserve the legacy "any error blocks"
    semantics.
    """
    return [e for e in errors if e.get("severity", "error") == "error"]


def _raise_if_blocking(errors: list[dict[str, Any]]) -> None:
    """Refuse a config write that has a blocking entry (P-0110).

    The 422 Problem Details body carries every entry, warnings included,
    so the client can show the whole picture; only ``severity="error"``
    entries decide the refusal (P-0100). A 200 therefore always means
    the config was saved (INV-API-1).
    """
    if _blocking_errors(errors):
        raise ValidationError(errors)


def require_relaunchable_config(ws: WorkspaceState, config: dict[str, Any]) -> None:
    """Raise :class:`ValidationError` if a newer rule refuses a stored config.

    Without this, a stored regression config that asks for stratification
    would start another job that fails asynchronously, instead of the 422
    ``/fit`` and ``/tune`` give before a job starts (P-0116 D5).
    """
    blocking = relaunch_rule_errors(ws, config)
    if blocking:
        raise ValidationError(blocking)


# --- Status / Reset ---


@router.get("/status", response_model=WorkspaceStatusResponse)
def workspace_status(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return current workspace state summary.

    Per BLUEPRINT §4.2.3: browser close = Results empty. Results are only
    available from volatile memory (set by the background job thread), never
    restored from disk.
    """
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
        "files_root": str(security.ALLOWED_FILES_ROOT),
    }


# H-0063 / Issue #99: the reset wait must be long enough to let a
# subprocess runner complete its cancel + proc.wait cycle. The
# subprocess path uses ``_WAIT_TIMEOUT = 10s`` in
# ``subprocess_runner.run_job_in_subprocess``, so we give the cancel
# that much plus a small buffer before declaring the slot orphaned and
# force-releasing. Without this margin, a reset during a legitimate
# tune could force-release the slot seconds before the subprocess is
# done tearing down, leaving a zombie child still writing to the
# progress file while the parent has already accepted a new fit.
_RESET_WAIT_TIMEOUT = 12.0
_RESET_WAIT_INTERVAL = 0.05


@router.post("/reset")
def workspace_reset(
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
    broadcaster: ProgressBroadcaster = Depends(get_broadcaster),
) -> dict[str, str]:
    """Reset all workspace state.

    Cancels and drains any background fit / tune first, then clears
    workspace state. The order is fixed (P-0119): (1) in one lifecycle
    lock section, advance the lifecycle reset generation (an older
    request can no longer be admitted) and cancel the active job; (2)
    wait for its slot, and force-release it if it does not drain, which
    ends the job ``cancelled``; (3) clear the workspace. The workspace is
    cleared *after* the slot wait so the shutting-down runner still sees
    live ``ws.dataframe`` / ``ws.model`` references.
    """
    teardown_active_job(
        job_store,
        broadcaster,
        timeout=_RESET_WAIT_TIMEOUT,
        interval=_RESET_WAIT_INTERVAL,
    )
    ws.reset()
    return {"status": "ok"}


# --- Data endpoints (BLUEPRINT §5.2 Data) ---


class DataPathRequest(BaseModel):
    path: str


@router.post("/data/path", response_model=DataLoadResponse)
def data_load_path(
    body: DataPathRequest,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Load data from a local file path.

    Uses the resolved path from ``validate_path_within`` for the
    subsequent exists / read operations so a symlink swap between the
    allow-list check and the actual load cannot redirect to a file
    outside ``ALLOWED_FILES_ROOT``.
    """
    try:
        resolved = validate_path_within(Path(body.path), security.ALLOWED_FILES_ROOT)
    except ValueError as exc:
        raise PathNotFoundError(str(exc)) from exc
    if not resolved.exists():
        raise PathNotFoundError(str(resolved))
    try:
        df = load_dataframe(str(resolved))
    except (FileNotFoundError, OSError) as exc:
        # File vanished between the exists() check and the read, or the
        # filesystem rejected the access outright.
        raise PathNotFoundError(str(resolved)) from exc
    except Exception as exc:  # noqa: BLE001 - pandas raises a wide variety
        raise FileInvalidError(str(exc)) from exc
    memory_usage_bytes = check_dataframe_memory(df)
    data_ref = make_data_ref(
        df, source_type="path", path=str(resolved), filename=resolved.name
    )
    ws.set_data(df, data_ref)
    return {"data_ref": asdict(data_ref), "memory_usage_bytes": memory_usage_bytes}


@router.post("/data/upload", response_model=DataLoadResponse)
async def data_upload(
    file: UploadFile,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Upload a CSV/Parquet file."""
    filename = file.filename or "upload"
    suffix = Path(filename).suffix
    if suffix not in (".csv", ".parquet"):
        raise FileInvalidError(f"Unsupported file type: {suffix}. Use .csv or .parquet")
    try:
        content = await read_upload_checked(file)
    except ValueError as exc:
        raise FileInvalidError(str(exc)) from exc
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, prefix="lizystudio_"
    ) as tmp:
        tmp.write(content)
        tmp_name = tmp.name
    try:
        df = load_dataframe(tmp_name)
    except Exception as exc:
        Path(tmp_name).unlink(missing_ok=True)
        raise FileInvalidError(str(exc)) from exc
    try:
        memory_usage_bytes = check_dataframe_memory(df)
    except FileInvalidError:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    data_ref = make_data_ref(df, source_type="upload", path=tmp_name, filename=filename)
    ws.set_data(df, data_ref)
    ws.track_temp_file(tmp_name)
    return {"data_ref": asdict(data_ref), "memory_usage_bytes": memory_usage_bytes}


@router.get("/data/preview", response_model=PreviewResponseModel)
def data_preview(
    rows: int = Query(default=50, ge=1, le=10000),
    max_cols: int | None = Query(default=None, ge=1, le=20000),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return first N rows of loaded data.

    ``max_cols`` (P-0097) caps the per-row column count so the wide-
    DataFrame UI (Issue #361) does not have to ship 10k+ columns to the
    browser on every preview call. ``total_cols`` in the response still
    reflects the ground-truth column count.
    """
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    return get_preview(ws.dataframe, rows=rows, max_cols=max_cols)


@router.get("/data/columns", response_model=ColumnsResponseModel)
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


@router.get("/data/column-stats/{col}")
def data_column_stats(
    col: str,
    top_n: int = 20,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return value distribution for a single column (H-0046)."""
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    try:
        stats = get_column_value_counts(ws.dataframe, col, top_n=top_n)
    except KeyError as exc:
        raise PathNotFoundError(str(exc)) from exc
    return asdict(stats)


@router.get("/data/split-preview", response_model=SplitPreviewResponseModel)
def data_split_preview(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return approximate fold sizes for the current CV split config.

    Computes sizes arithmetically from n_rows and config — no sklearn needed.
    Requires both data and config (with ``split.method`` and ``split.n_splits``)
    to be set in the workspace.
    """
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    if not ws.config:
        raise WorkspaceNoConfigError()
    split_cfg = ws.config.get("split", {})
    strategy = split_cfg.get("method", "")
    n_splits = split_cfg.get("n_splits", 5)
    gap = split_cfg.get("gap", 0)
    max_train_size = split_cfg.get("max_train_size")
    max_test_size = split_cfg.get("max_test_size")
    n_rows = len(ws.dataframe)
    preview = compute_split_preview(
        n_rows,
        strategy,
        n_splits,
        gap=gap,
        max_train_size=max_train_size,
        max_test_size=max_test_size,
    )
    return asdict(preview)


# --- Config endpoints (BLUEPRINT §5.2 Config) ---


@router.get("/config/schema")
def config_schema(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return the backend's config JSON Schema."""
    return get_config_schema(ws)


@router.get("/config/defaults")
def config_defaults(
    task: str,
    target: str,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return a complete default config for the given task and target."""
    return get_default_config(ws, task, target)


@router.get("/config")
def config_get(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return the current workspace config.

    PR-4b: the response includes a materialised ``tuning`` block
    synthesised from ``ws.tuning_overrides`` so the legacy pre-PR-5
    frontend keeps seeing ``config.tuning`` even after the storage
    rename. Once PR-5 ships, the frontend reads
    ``GET /config/tuning-snapshot`` directly and this compat shim
    becomes load-bearing only for YAML download / CLI consumers.
    """
    return get_legacy_config_view(ws)


def _check_workspace_lock(job_store: JobStore) -> None:
    """Raise ``WorkspaceLockedError`` iff a non-terminal job holds the slot.

    P-0089 / Issue #279: the config must be immutable while a fit/tune
    job is actively running, but **only while it is actively running**.
    Once a job transitions to a terminal status (``completed`` /
    ``failed`` / ``cancelled``), the workspace must accept config
    writes again — even if the runner's ``finally`` block has not yet
    called ``release_active`` to drop the slot.

    Without this terminal-status carve-out, the post-fit re-fit flow
    (``waitForJobDone`` returns the moment status flips, but
    ``release_active`` lags by an arbitrary number of microseconds)
    races against the lock and produces spurious 409s for clients
    that did the right thing — see the ``jobs-refit.spec.ts`` E2E
    failure that surfaced this.
    """
    holder = job_store.active_job_id
    if holder is None:
        return
    holder_job = job_store.get(holder)
    if holder_job is not None and holder_job.status in (
        "completed",
        "failed",
        "cancelled",
    ):
        return
    raise WorkspaceLockedError(holder)


@router.put(
    "/config",
    response_model=ConfigUpdateResponse,
    responses=problem_responses(409, 422),
)
def config_update(
    body: dict[str, Any],
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Update config with validation.

    P-0089 / Issue #279: while a fit/tune job is actively running, the
    config it was created with must be immutable. Cross-hook competing
    writes (CV strategy radio, Folds NumberInput, target/task
    RadioGroup) used to land mid-run and silently corrupt the config
    the job's checkpoint and ``meta.json`` were based on. Reject such
    writes with 409 ``WORKSPACE_LOCKED`` so the frontend can surface a
    clear toast and re-sync. See ``_check_workspace_lock`` for the
    terminal-status carve-out that lets the post-fit re-fit flow
    proceed without racing against the runner's slot release.
    """
    _check_workspace_lock(job_store)
    errors = validate_config(ws, body)
    _raise_if_blocking(errors)
    # P-0109 PR-4b: legacy PUT /config payloads still carry the
    # materialised ``tuning`` block (pre-PR-5 frontend). Divert it
    # into ``ws.tuning_overrides`` so the storage rename stays
    # consistent, then store the stripped config so the workspace
    # never holds two copies of the same intent.
    stripped = absorb_legacy_tuning(ws, body)
    ws.set_config(stripped)
    return {"config": body, "validation_errors": errors}


@router.patch("/config", response_model=ConfigPatchResponse)
def config_patch(
    body: dict[str, Any],
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Partially update config via patch operations (H-0037).

    P-0089 / Issue #279: same running-lock semantics as
    ``config_update``. Patches against a locked workspace return 409
    so the frontend can drop the in-flight edit and re-fetch.
    """
    _check_workspace_lock(job_store)
    if not ws.config:
        raise WorkspaceNoConfigError()
    ops = body.get("ops", [])
    if not isinstance(ops, list):
        raise InvalidPatchError("'ops' must be a list")
    try:
        patched = apply_config_patch(ws.config, ops)
    except ValueError as exc:
        raise InvalidPatchError(str(exc)) from exc
    ws.set_config(patched)
    return {"config": patched}


@router.get("/config/tuning-snapshot", response_model=TuningSnapshotResponse)
def config_tuning_snapshot(
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return the Tune-tab intent/effective split (P-0109 PR-4a).

    Produces ``{tuning_effective, tuning_defaults}`` derived live from
    the currently-persisted ``ws.config["tuning"]`` via the adapter's
    catalog (see :func:`get_tuning_snapshot` for the projection rule).

    The endpoint is read-only and storage-shape neutral: PR-4b will move
    the workspace to persist sparse :class:`TuningOverrides` directly,
    at which point the projection from legacy nested shape becomes a
    pass-through. The frontend (PR-5) consumes this snapshot to render
    Tune-tab rows without the racing seed-then-edit useEffects.
    """
    return get_tuning_snapshot(ws)


@router.put("/config/tuning-overrides", response_model=TuningOverridesUpdateResponse)
def config_tuning_overrides_update(
    body: TuningOverrides,
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Apply sparse Tune overrides and return the resulting effective config.

    Body is parsed as :class:`TuningOverrides` (P-0109): every field is
    optional, ``extra="forbid"`` catches typos, and Pydantic's
    ``model_fields_set`` lets the merge distinguish "explicit None" from
    "unset" (INV-T1 / Q4).

    The legacy ``ws.config["tuning"]`` block is rebuilt from the
    effective result so the existing tune-job path and the PUT /config
    GET round-trip keep working unchanged — PR-4b moves storage to the
    sparse form. The same workspace-lock semantics as PUT /config apply:
    a tune job that is still running blocks the write with 409 (P-0089).
    """
    _check_workspace_lock(job_store)
    return update_tuning_overrides(ws, body)


@router.post("/config/validate", response_model=ValidationResponse)
def config_validate(
    body: dict[str, Any] | None = None,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Validate config without saving.

    If no body is provided, validates the current workspace config.
    """
    config = body if body is not None else ws.config
    if not config:
        raise WorkspaceNoConfigError()
    errors = validate_config(ws, config)
    return {"valid": len(_blocking_errors(errors)) == 0, "errors": errors}


@router.post(
    "/config/upload",
    response_model=ConfigUpdateResponse,
    responses=problem_responses(400, 422),
)
async def config_upload(
    file: UploadFile,
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Load config from an uploaded YAML/JSON file."""
    try:
        content = await read_upload_checked(file)
    except ValueError as exc:
        raise FileInvalidError(str(exc)) from exc
    filename = file.filename or "config.yaml"
    try:
        config = load_config_from_file(ws, content, filename)
    except Exception as exc:
        raise ConfigImportError(str(exc)) from exc
    errors = validate_config(ws, config)
    _raise_if_blocking(errors)
    ws.set_config(config)
    return {"config": config, "validation_errors": errors}


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


@router.post(
    "/fit",
    response_model=JobStartResponse,
    responses=problem_responses(400, 409, 422),
)
def workspace_fit(
    body: Annotated[WorkspaceFitRequest, Body()] = WorkspaceFitRequest(),
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
    broadcaster: ProgressBroadcaster = Depends(get_broadcaster),
) -> dict[str, Any]:
    """Create a fit job (thread managed by Service layer).

    P-0086 (Issue #251): ``body.config`` may be provided to atomically
    overwrite ``ws.config`` at fit time, closing the race window between
    a pending ``PUT /config`` and the ``POST /fit`` call. The body is
    declared with a ``WorkspaceFitRequest()`` default (rather than
    ``| None``) because ``from __future__ import annotations`` together
    with ``Optional`` + ``Depends`` breaks FastAPI's body detection,
    causing the parameter to be parsed as a query string.

    P-0119: the job is created holding the slot, and admitted
    (``running``) by the launcher before it waits for the previous
    worker. A reset or a cancel between the two, or a failed wait,
    answers 409 ``JOB_CONFLICT``; the job is then ``cancelled`` or
    ``failed``.
    """
    # P-0086: apply body.config first so validate runs against what the
    # caller actually wants to fit, and so ws.config ends up matching
    # the config recorded in the job's meta.json.
    if body.config is not None:
        candidate = body.config
        errors = validate_config(ws, candidate)
        # PR-D1 / Issue #394: only severity="error" entries block Fit;
        # severity="warning" advisories (e.g. mape on zero target) must
        # not raise here — the user has already seen the yellow banner
        # and chosen to proceed. ``_blocking_errors`` defaults missing
        # severity to "error" for pre-PR-B4 backward compatibility.
        blocking = _blocking_errors(errors)
        if blocking:
            raise ValidationError(blocking)
        # P-0109 PR-4b: same compat shim as PUT /config — divert any
        # ``tuning`` block in the body into ``ws.tuning_overrides`` so
        # the storage rename stays consistent through every config-set
        # entry point.
        ws.set_config(absorb_legacy_tuning(ws, candidate))
    if not ws.config:
        raise WorkspaceNoConfigError()
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()
    errors = validate_config(ws, ws.config)
    blocking = _blocking_errors(errors)
    if blocking:
        raise ValidationError(blocking)
    # CRITICAL-2: atomically claim the active slot and create the job
    # metadata in a single critical section so two concurrent
    # /fit requests cannot race past the has_active_job check and
    # leave an orphan "failed" job on disk.
    # P-0119: the reservation and the request's lifecycle reset generation
    # are taken in one lock section; the launcher admits with them.
    reservation = job_store.create_and_reserve(
        backend_name=get_backend_name(ws),
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="fit",
    )
    if reservation is None:
        raise JobConflictError(job_store.active_job_id or "unknown")
    job, reset_gen = reservation
    dataframe = ws.dataframe
    job_id = launch_reserved(
        job_store,
        broadcaster,
        job,
        lambda: start_fit_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config=ws.config,
            dataframe=dataframe,
            job=job,
            reset_gen=reset_gen,
        ),
    )
    return {"job_id": job_id}


@router.post(
    "/tune",
    response_model=JobStartResponse,
    responses=problem_responses(400, 409, 422),
)
def workspace_tune(
    body: Annotated[WorkspaceTuneRequest, Body()] = WorkspaceTuneRequest(),
    ws: WorkspaceState = Depends(get_workspace),
    job_store: JobStore = Depends(get_job_store),
    broadcaster: ProgressBroadcaster = Depends(get_broadcaster),
) -> dict[str, Any]:
    """Create a tune job (thread managed by Service layer).

    P-0086 (Issue #251): ``body.config`` may be provided to atomically
    overwrite ``ws.config`` at tune time. See ``workspace_fit`` above
    for the rationale behind the ``WorkspaceTuneRequest()`` default.

    P-0119: admission and the 409 ``JOB_CONFLICT`` answers are the same
    as for ``POST /fit``.
    """
    # P-0086: same semantics as workspace_fit — body.config wins and
    # updates ws.config before tuning injection / validation runs.
    if body.config is not None:
        candidate = body.config
        errors = validate_config(ws, candidate)
        # PR-D1 / Issue #394: severity-aware gating — see workspace_fit
        # above for the full rationale.
        blocking = _blocking_errors(errors)
        if blocking:
            raise ValidationError(blocking)
        # P-0109 PR-4b: divert any ``tuning`` block into
        # ``ws.tuning_overrides``; same compat shim as workspace_fit.
        ws.set_config(absorb_legacy_tuning(ws, candidate))
    if not ws.config:
        raise WorkspaceNoConfigError()
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()
    # P-0109 PR-4b / INV-T6: materialize the effective Tune config from
    # ``ws.tuning_overrides`` into the per-job config snapshot at
    # job-start time. ``job.config["tuning"]`` is frozen here so the
    # tune run remains reproducible even if the backend catalog evolves
    # between this PUT and the next one. Replaces the legacy default-
    # tuning injection (was inlined as a hardcoded ``{n_trials: 50,
    # timeout: None, space: {}}``); direction is now resolved through
    # the adapter (INV-T3) instead of via the hardcoded maximize set.
    job_config = materialize_tuning_for_job(ws)
    errors = validate_config(ws, job_config)
    blocking = _blocking_errors(errors)
    if blocking:
        raise ValidationError(blocking)
    # P-0108 / Issue #474: run-gate-only check for structurally-broken
    # tuning.optuna.space entries (inverted Range, log+low<=0). Kept out
    # of ``validate_config`` so the save gate (``PUT /config``) stays
    # permissive for WIP edits — see services.workspace docstring.
    space_errors = validate_search_space_for_tune(ws, job_config)
    if space_errors:
        raise ValidationError(space_errors)
    # CRITICAL-2: atomic create + slot claim, see workspace_fit above.
    # P-0119: the reservation and the request's lifecycle reset generation
    # are taken in one lock section; the launcher admits with them.
    reservation = job_store.create_and_reserve(
        backend_name=get_backend_name(ws),
        config=job_config,
        data_ref=ws.data_ref,
        job_type="tune",
    )
    if reservation is None:
        raise JobConflictError(job_store.active_job_id or "unknown")
    job, reset_gen = reservation
    dataframe = ws.dataframe
    job_id = launch_reserved(
        job_store,
        broadcaster,
        job,
        lambda: start_tune_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config=job_config,
            dataframe=dataframe,
            job=job,
            reset_gen=reset_gen,
        ),
    )
    return {"job_id": job_id}
