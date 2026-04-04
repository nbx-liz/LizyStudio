"""Training service — run fit/tune jobs (BLUEPRINT §4.2.4, H-0002 B, H-0011).

Provides both synchronous `run_fit`/`run_tune` and async launcher helpers
`start_fit_async`/`start_tune_async` that handle thread creation and
workspace state updates (Phase 29 — Router must NOT own threads).
"""

from __future__ import annotations

import io
import logging
import threading
import traceback
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from lizystudio.backends.base import BackendAdapter, ProgressCallback
from lizystudio.backends.types import FitSummary, TuningSummary
from lizystudio.services.jobs import Job, JobStore

if TYPE_CHECKING:
    from lizystudio.services.workspace import WorkspaceState
    from lizystudio.ws.progress import ProgressBroadcaster

_logger = logging.getLogger(__name__)


class CancelledError(Exception):
    """Raised when a job's cancellation flag is detected."""


def _make_cancel_aware_cb(
    job_id: str,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster | None,
) -> ProgressCallback:
    """Create a progress callback that checks for cancellation (H-0011)."""

    def callback(*, current: int, total: int, message: str) -> None:
        if job_store.is_cancel_requested(job_id):
            raise CancelledError
        if broadcaster is not None:
            broadcaster.send_progress(
                job_id,
                current=current,
                total=total,
                message=message,
            )

    return callback


def _run_job_core(
    *,
    job: Job,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster | None,
    execute_fn: Callable[
        [ProgressCallback],
        tuple[FitSummary, TuningSummary | None, str],
    ],
) -> Job:
    """Shared execution wrapper for fit/tune jobs.

    Handles status transitions, log capture, error handling, and persistence.
    """
    if not job_store.claim_active(job.job_id):
        job.status = "failed"
        job.error = "Another job is already running"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
        if broadcaster is not None:
            broadcaster.send_error(
                job.job_id, "Another job is already running", code="JOB_CONFLICT"
            )
        return job

    job.status = "running"
    job_store.update(job)

    cb = _make_cancel_aware_cb(job.job_id, job_store, broadcaster)

    # Capture execution logs with a scoped logger (not root)
    log_buffer = io.StringIO()
    handler = logging.StreamHandler(log_buffer)
    handler.setLevel(logging.DEBUG)
    job_logger = logging.getLogger(f"lizystudio.training.{job.job_id}")
    job_logger.addHandler(handler)
    job_logger.setLevel(logging.DEBUG)

    try:
        fit_result, tune_result, model_dir = execute_fn(cb)
        job.status = "completed"
        job.fit_result = fit_result
        job.tune_result = tune_result
        job.model_path = model_dir
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
        if broadcaster is not None:
            broadcaster.send_completed(job.job_id)
    except CancelledError:
        job.status = "cancelled"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
        if broadcaster is not None:
            broadcaster.send_error(job.job_id, "Job cancelled", code="JOB_CANCELLED")
    except Exception as exc:
        job.status = "failed"
        # Full traceback stored to disk; sanitized message sent to clients
        job.error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
        if broadcaster is not None:
            safe_msg = f"{type(exc).__name__}: {exc}"
            broadcaster.send_error(job.job_id, safe_msg)
    finally:
        job_store.release_active(job.job_id)
        job_store.clear_cancel(job.job_id)
        job_logger.removeHandler(handler)
        handler.close()
        log_path = job_store.jobs_dir / job.job_id / "execution.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(log_buffer.getvalue(), encoding="utf-8")

    return job


def run_fit(
    *,
    job: Job,
    job_store: JobStore,
    backend: BackendAdapter,
    config: dict[str, Any],
    dataframe: Any,
    params: dict[str, Any] | None = None,
    broadcaster: ProgressBroadcaster | None = None,
) -> Job:
    """Execute a fit job synchronously. Updates job in-place and on disk."""

    def execute(cb: ProgressCallback) -> tuple[FitSummary, TuningSummary | None, str]:
        model = backend.create_model(config, dataframe)
        fit_result: FitSummary = backend.fit(model, params=params, on_progress=cb)
        model_dir = str(job_store.jobs_dir / job.job_id / "model")
        backend.export_model(model, model_dir)
        return fit_result, None, model_dir

    return _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=broadcaster,
        execute_fn=execute,
    )


def run_tune(
    *,
    job: Job,
    job_store: JobStore,
    backend: BackendAdapter,
    config: dict[str, Any],
    dataframe: Any,
    broadcaster: ProgressBroadcaster | None = None,
) -> Job:
    """Execute a tune job: tune -> auto-fit with best params (H-0002 B)."""

    def execute(cb: ProgressCallback) -> tuple[FitSummary, TuningSummary | None, str]:
        model = backend.create_model(config, dataframe)
        tune_result: TuningSummary = backend.tune(model, on_progress=cb)
        model2 = backend.create_model(config, dataframe)
        fit_result: FitSummary = backend.fit(model2, params=tune_result.best_params)
        model_dir = str(job_store.jobs_dir / job.job_id / "model")
        backend.export_model(model2, model_dir)
        return fit_result, tune_result, model_dir

    return _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=broadcaster,
        execute_fn=execute,
    )


# --- Async launchers (Phase 29: thread ownership in Service, not Router) ---

_JOIN_TIMEOUT = 5  # seconds


def _join_previous_thread(ws: WorkspaceState) -> None:
    """Join the previous job thread if it exists (H-0040).

    Prevents thread/OpenMP thread-pool accumulation by ensuring the prior
    worker is cleaned up before spawning a new one.
    """
    with ws._lock:
        prev = ws._job_thread
    if prev is not None and prev.is_alive():
        prev.join(timeout=_JOIN_TIMEOUT)
        if prev.is_alive():
            _logger.warning(
                "Previous job thread did not finish within %ds — proceeding anyway",
                _JOIN_TIMEOUT,
            )


def start_fit_async(
    *,
    ws: WorkspaceState,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster,
    config: dict[str, Any],
    dataframe: Any,
    job: Job,
) -> str:
    """Spawn a background thread for fit; update workspace state on completion."""
    _join_previous_thread(ws)

    def _run() -> None:
        finished = run_fit(
            job=job,
            job_store=job_store,
            backend=ws.backend,
            config=config,
            dataframe=dataframe,
            broadcaster=broadcaster,
        )
        with ws._lock:
            ws.workspace_fit_result = finished.fit_result
            ws.workspace_tune_result = None
            ws.current_job_id = finished.job_id

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    with ws._lock:
        ws._job_thread = t
    return job.job_id


def start_tune_async(
    *,
    ws: WorkspaceState,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster,
    config: dict[str, Any],
    dataframe: Any,
    job: Job,
) -> str:
    """Spawn a background thread for tune; update workspace state on completion."""
    _join_previous_thread(ws)

    def _run() -> None:
        finished = run_tune(
            job=job,
            job_store=job_store,
            backend=ws.backend,
            config=config,
            dataframe=dataframe,
            broadcaster=broadcaster,
        )
        with ws._lock:
            ws.workspace_fit_result = finished.fit_result
            ws.workspace_tune_result = finished.tune_result
            ws.current_job_id = finished.job_id

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    with ws._lock:
        ws._job_thread = t
    return job.job_id
