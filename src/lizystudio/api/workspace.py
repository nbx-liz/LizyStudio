"""Workspace API router (BLUEPRINT §5.2).

Covers: status, reset, data, config, fit, tune.
"""

from __future__ import annotations

import copy
import logging
import tempfile
import time
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Any

import yaml
from fastapi import APIRouter, Body, Depends, Query, Request, UploadFile  # noqa: F401
from fastapi.responses import Response
from pydantic import BaseModel  # noqa: F401

import lizystudio.security as security
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
    ValidationResponse,
    WorkspaceFitRequest,
    WorkspaceStatusResponse,
    WorkspaceTuneRequest,
)
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
    PreviousJobStillRunningError,
    start_fit_async,
    start_tune_async,
)
from lizystudio.services.workspace import (
    WorkspaceState,
    apply_config_patch,
    get_backend_name,
    get_config_schema,
    get_default_config,
    get_workspace,
    load_config_from_file,
    validate_config,
)
from lizystudio.ws.progress import ProgressBroadcaster

router = APIRouter()
_log = logging.getLogger(__name__)


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
) -> dict[str, str]:
    """Reset all workspace state.

    H-0063 / Issue #99: if a fit / tune is still running in the
    background, reset must also cancel it and release the JobStore
    active slot. Otherwise the next Fit / Tune click gets a
    JOB_CONFLICT 409, directly contradicting the user's expectation
    that "reset" yields a clean slate.

    The cancel path mirrors the existing ``POST /jobs/{id}/cancel``
    endpoint: we call ``request_cancel`` and rely on the runner (either
    the in-process thread via ``_run_job_core``'s cancel-aware callback
    or the subprocess via ``_poll_progress``'s cancel polling) to
    transition the job to ``cancelled`` and release the slot from its
    finally block. We then wait briefly for the slot to become free
    so the caller can immediately start a new Fit / Tune without
    racing the cancel.

    Degraded paths we explicitly tolerate:

    1. **Terminal holder (crashed runner finally)** — if the slot is
       held but the job's on-disk status is already terminal, no one
       will ever call ``release_active`` for it. We short-circuit by
       calling ``force_release_active_if`` directly.
    2. **No live runner (orphan slot)** — the slot may have been
       claimed by a previous process / test / client that died
       without draining the slot. The cancel flag lands in memory but
       no runner observes it, so the wait loop would time out. In
       that case we **force-release the slot** from reset itself.
       Rationale: the user clicked reset expressly to clear state;
       returning 200 with the slot still held would reintroduce the
       exact ``JOB_CONFLICT`` regression this fix is trying to remove.
       The wait budget (``_RESET_WAIT_TIMEOUT``) is deliberately set
       longer than ``subprocess_runner._WAIT_TIMEOUT`` so that a
       legitimate subprocess runner has time to finish its
       ``proc.terminate`` / ``proc.wait`` cycle and call
       ``release_active`` from its own finally, before we fall
       through to the force-release branch. If we still time out,
       the most plausible explanation is an orphaned slot with no
       runner behind it, and force-releasing is strictly better than
       leaving the user with a broken reset button.

    The force-release uses ``force_release_active_if`` which is
    atomic under ``JobStore._active_lock``: the slot is released only
    if it still holds the exact id we observed, so a racy
    ``create_and_claim_active`` from another thread between the
    observation and the release cannot accidentally clear the new
    owner's slot.

    Workspace state is cleared AFTER the cancel + slot wait so the
    shutting-down runner thread still sees live ``ws.dataframe`` /
    ``ws.model`` references during its finally path.
    """
    active_id = job_store.active_job_id
    if active_id is not None:
        active_job = job_store.get(active_id)
        is_terminal = active_job is not None and active_job.status in (
            "completed",
            "failed",
            "cancelled",
        )
        if not is_terminal:
            job_store.request_cancel(active_id)

        deadline = time.monotonic() + _RESET_WAIT_TIMEOUT
        released = False
        while time.monotonic() < deadline:
            if not job_store.has_active_job():
                released = True
                break
            # Degraded path 1: the holder became terminal on disk
            # without release_active being called (crashed runner
            # finally block). Reclaim the slot atomically so we do
            # not race a new claim from a parallel request.
            current = job_store.active_job_id
            if current is not None:
                current_job = job_store.get(current)
                if (
                    current_job is not None
                    and current_job.status
                    in (
                        "completed",
                        "failed",
                        "cancelled",
                    )
                    and job_store.force_release_active_if(current)
                ):
                    released = True
                    break
            time.sleep(_RESET_WAIT_INTERVAL)

        if not released:
            # Degraded path 2: no runner picked up the cancel within
            # the budget. Force-release atomically to keep reset
            # honest — the compare-and-release inside
            # force_release_active_if guarantees we only clear the
            # exact id we observed, never a new claim that landed in
            # between.
            stuck_id = job_store.active_job_id
            if stuck_id is not None and job_store.force_release_active_if(stuck_id):
                _log.warning(
                    "workspace_reset: active slot %s did not release "
                    "within %.2fs; force-released so the next fit / "
                    "tune does not JOB_CONFLICT",
                    stuck_id,
                    _RESET_WAIT_TIMEOUT,
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
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, Any]:
    """Return first N rows of loaded data."""
    if ws.dataframe is None:
        raise WorkspaceNoDataError()
    return get_preview(ws.dataframe, rows=rows)


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
    """Return the current workspace config."""
    return ws.config


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


@router.put("/config", response_model=ConfigUpdateResponse)
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
    if not errors:
        ws.set_config(body)
    return {"config": body, "errors": errors, "saved": len(errors) == 0}


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
    return {"valid": len(errors) == 0, "errors": errors}


@router.post("/config/upload", response_model=ConfigUpdateResponse)
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
    if not errors:
        ws.set_config(config)
    return {"config": config, "errors": errors, "saved": len(errors) == 0}


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


@router.post("/fit", response_model=JobStartResponse)
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
    """
    # P-0086: apply body.config first so validate runs against what the
    # caller actually wants to fit, and so ws.config ends up matching
    # the config recorded in the job's meta.json.
    if body.config is not None:
        candidate = body.config
        errors = validate_config(ws, candidate)
        if errors:
            raise ValidationError(errors)
        ws.set_config(candidate)
    if not ws.config:
        raise WorkspaceNoConfigError()
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()
    errors = validate_config(ws, ws.config)
    if errors:
        raise ValidationError(errors)
    # CRITICAL-2: atomically claim the active slot and create the job
    # metadata in a single critical section so two concurrent
    # /fit requests cannot race past the has_active_job check and
    # leave an orphan "failed" job on disk.
    job = job_store.create_and_claim_active(
        backend_name=get_backend_name(ws),
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="fit",
    )
    if job is None:
        raise JobConflictError(job_store.active_job_id or "unknown")
    try:
        job_id = start_fit_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config=ws.config,
            dataframe=ws.dataframe,
            job=job,
        )
    except PreviousJobStillRunningError:
        job.status = "failed"
        job.error = "Previous job still running"
        job_store.update(job)
        job_store.release_active(job.job_id)
        # Issue #154: record the terminal status so the
        # lizystudio_jobs_total{status="failed"} counter is not under-
        # counted on slot-claim-after-claim failures.
        job_store.record_job_terminal(job.job_type, "failed")
        raise JobConflictError(job.job_id) from None
    except Exception:
        # Any other failure after we claimed the slot must release it,
        # otherwise the slot stays held until server restart. Emit the
        # failed metric (#154) before re-raising so the counter
        # reflects the true failure count.
        job_store.release_active(job.job_id)
        job_store.record_job_terminal(job.job_type, "failed")
        raise
    return {"job_id": job_id}


@router.post("/tune", response_model=JobStartResponse)
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
    """
    # P-0086: same semantics as workspace_fit — body.config wins and
    # updates ws.config before tuning injection / validation runs.
    if body.config is not None:
        candidate = body.config
        errors = validate_config(ws, candidate)
        if errors:
            raise ValidationError(errors)
        ws.set_config(candidate)
    if not ws.config:
        raise WorkspaceNoConfigError()
    if ws.dataframe is None or ws.data_ref is None:
        raise WorkspaceNoDataError()
    # Inject default tuning config if not set (H-0025) — immutable copy.
    #
    # Direction is intentionally NOT hardcoded here (Bug 2026-04-14): a
    # ``minimize`` default would override the AUC / R2 / accuracy class
    # of metrics that should be maximized, and ``_prepare_tune_config``'s
    # auto-resolve was guarded by ``"direction" not in params`` so the
    # wrong value silently propagated to Optuna. The auto-resolve in
    # ``_prepare_tune_config`` is now the single source of truth — it
    # reads ``evaluation.metrics`` and picks ``maximize`` / ``minimize``
    # from the maximize-set table. Leaving direction unset here lets that
    # resolver fire on every fresh tune.
    if ws.config.get("tuning") is None:
        config_with_tuning = copy.deepcopy(ws.config)
        config_with_tuning["tuning"] = {
            "optuna": {
                "params": {"n_trials": 50, "timeout": None},
                "space": {},
            }
        }
        ws.set_config(config_with_tuning)
    errors = validate_config(ws, ws.config)
    if errors:
        raise ValidationError(errors)
    # CRITICAL-2: atomic create + slot claim, see workspace_fit above.
    job = job_store.create_and_claim_active(
        backend_name=get_backend_name(ws),
        config=ws.config,
        data_ref=ws.data_ref,
        job_type="tune",
    )
    if job is None:
        raise JobConflictError(job_store.active_job_id or "unknown")
    try:
        job_id = start_tune_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config=ws.config,
            dataframe=ws.dataframe,
            job=job,
        )
    except PreviousJobStillRunningError:
        job.status = "failed"
        job.error = "Previous job still running"
        job_store.update(job)
        job_store.release_active(job.job_id)
        # Issue #154: record the terminal status (same fix as /fit).
        job_store.record_job_terminal(job.job_type, "failed")
        raise JobConflictError(job.job_id) from None
    except Exception:
        job_store.release_active(job.job_id)
        job_store.record_job_terminal(job.job_type, "failed")
        raise
    return {"job_id": job_id}
