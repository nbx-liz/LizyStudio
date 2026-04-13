"""Training service — run fit/tune jobs (BLUEPRINT §4.2.4, H-0002 B, H-0011).

Provides both synchronous `run_fit`/`run_tune` and async launcher helpers
`start_fit_async`/`start_tune_async` that handle thread creation and
workspace state updates (Phase 29 — Router must NOT own threads).
"""

from __future__ import annotations

import copy
import io
import logging
import threading
import traceback
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
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

    def callback(
        *,
        current: int,
        total: int,
        message: str,
        **extra: Any,
    ) -> None:
        if job_store.is_cancel_requested(job_id):
            raise CancelledError
        if broadcaster is not None:
            broadcaster.send_progress(
                job_id,
                current=current,
                total=total,
                message=message,
                fold_results=extra.get("fold_results"),
                trial_results=extra.get("trial_results"),
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
    except (CancelledError, KeyboardInterrupt):
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


def _save_tuning_plot(
    backend: BackendAdapter,
    model: Any,
    job_dir: Path,
) -> None:
    """Persist the tuning plot JSON so it survives model export (H-0002 B).

    The exported model (fit with best_params) loses Optuna study data,
    so we capture the plot from the original tune model.
    """
    try:
        plot_data = backend.plot(model, "tuning")
        path = job_dir / "tuning_plot.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(plot_data.plotly_json, encoding="utf-8")
    except Exception:  # noqa: BLE001
        _logger.warning(
            "Failed to save tuning plot for %s", job_dir.name, exc_info=True
        )


def _prepare_autofit_config(
    config: dict[str, Any], best_params: dict[str, Any]
) -> dict[str, Any]:
    """Build a fit-ready config from the original config + best_params.

    Uses the original config as base (same as Apply to Fit) and merges
    best_params into model.params.  The tuning section is stripped since
    it is not needed for a plain fit.
    """

    result = copy.deepcopy(config)
    model = dict(result.get("model", {}))
    existing_params = dict(model.get("params", {}))
    model["params"] = {**existing_params, **best_params}
    result["model"] = model
    # Remove tuning section — not needed for fit
    result.pop("tuning", None)
    return result


def _extract_re_tune(config: dict[str, Any]) -> dict[str, Any] | None:
    """Extract the H-0061 ``re_tune`` block from a tune request config.

    Returns ``None`` when the client did not request multi-round tuning,
    so legacy single-round behaviour is unaffected.  The returned dict
    is a shallow copy to avoid leaking mutations back into the caller.
    """
    tuning = config.get("tuning")
    if not isinstance(tuning, dict):
        return None
    re_tune = tuning.get("re_tune")
    if not isinstance(re_tune, dict):
        return None
    return dict(re_tune)


def _prepare_tune_config(config: dict[str, Any]) -> dict[str, Any]:
    """Merge tuning-specific overrides into the top-level config for LizyML.

    The frontend stores tune-specific values at:
    - tuning.evaluation → merged into config.evaluation
    - tuning.model_params → merged into config.model.params
    - tuning.training → merged into config.training

    This mirrors LizyML-Widget's ``prepare_tune_overrides``.
    """

    result = copy.deepcopy(config)
    tune_section = result.get("tuning", {})

    # Merge tuning.evaluation → top-level evaluation
    tune_eval = tune_section.get("evaluation")
    if isinstance(tune_eval, dict) and tune_eval:
        result["evaluation"] = dict(tune_eval)

    # Merge tuning.model_params → model.params
    tune_model_params = tune_section.get("model_params")
    if isinstance(tune_model_params, dict) and tune_model_params:
        model = dict(result.get("model", {}))
        existing_params = dict(model.get("params", {}))
        # Filter out internal keys (prefixed with _)
        clean_params = {
            k: v for k, v in tune_model_params.items() if not k.startswith("_")
        }
        model["params"] = {**existing_params, **clean_params}
        result["model"] = model

    # Merge tuning.training → training
    tune_training = tune_section.get("training")
    if isinstance(tune_training, dict) and tune_training:
        existing_training = dict(result.get("training", {}))
        result["training"] = {**existing_training, **tune_training}

    # Ensure evaluation.metrics is non-empty so LizyML knows what to optimize.
    # If the user didn't explicitly select a metric, use the preferred default.
    eval_section = result.get("evaluation")
    eval_metrics = (
        (eval_section or {}).get("metrics", [])
        if isinstance(eval_section, dict)
        else []
    )
    if not eval_metrics:
        task = result.get("task", "")
        preferred: dict[str, str] = {
            "binary": "auc",
            "regression": "rmse",
            "multiclass": "auc",
        }
        default_metric = preferred.get(task, "")
        if default_metric:
            result["evaluation"] = {"metrics": [default_metric]}

    # Resolve direction from evaluation metrics if not explicitly set
    if "tuning" in result:
        optuna = result["tuning"].get("optuna", {})
        params = optuna.get("params", {})
        if "direction" not in params:
            final_metrics = (result.get("evaluation") or {}).get("metrics", [])
            if final_metrics:
                first_metric = (
                    final_metrics[0]
                    if isinstance(final_metrics[0], str)
                    else next(iter(final_metrics[0]), "")
                )
                maximize_metrics = {
                    "auc",
                    "auc_pr",
                    "r2",
                    "accuracy",
                    "f1",
                    "auc_mu",
                }
                direction = (
                    "maximize" if first_metric in maximize_metrics else "minimize"
                )
                optuna["params"] = {**params, "direction": direction}
                result["tuning"]["optuna"] = optuna

    # Clean tuning section: keep only optuna (params + space)
    if "tuning" in result:
        result["tuning"] = {"optuna": result["tuning"].get("optuna", {})}

    return result


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
    tune_config = _prepare_tune_config(config)
    re_tune = _extract_re_tune(config)
    # H-0062: checkpoint directory for incremental trial persistence.
    checkpoint_dir = job_store.jobs_dir / job.job_id

    def execute(cb: ProgressCallback) -> tuple[FitSummary, TuningSummary | None, str]:
        model = backend.create_model(tune_config, dataframe)
        tune_result: TuningSummary = backend.tune(
            model,
            on_progress=cb,
            re_tune=re_tune,
            checkpoint_dir=checkpoint_dir,
        )

        # Capture tuning plot from the tune model before creating model2.
        # The exported model2 (fit with best params) loses tuning history.
        _save_tuning_plot(backend, model, job_store.jobs_dir / job.job_id)

        # Build fit config from the ORIGINAL config (not tune_config) with
        # best_params merged into model.params.  This ensures the auto-fit
        # model uses the same parameter base as "Apply to Fit → Fit".
        fit_config = _prepare_autofit_config(config, tune_result.best_params)
        model2 = backend.create_model(fit_config, dataframe)
        fit_result: FitSummary = backend.fit(model2, on_progress=cb)
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

_JOIN_TIMEOUT = 30  # seconds — generous to allow subprocess cleanup


class PreviousJobStillRunningError(Exception):
    """Raised when a previous job thread is still alive after join timeout."""


def _join_previous_thread(ws: WorkspaceState) -> None:
    """Join the previous job thread if it exists (H-0040).

    Prevents thread/OpenMP thread-pool accumulation by ensuring the prior
    worker is cleaned up before spawning a new one.

    Raises PreviousJobStillRunningError if the thread does not finish
    within _JOIN_TIMEOUT seconds (prevents concurrent tune execution).
    """
    with ws._lock:
        prev = ws._job_thread
    if prev is not None and prev.is_alive():
        prev.join(timeout=_JOIN_TIMEOUT)
        if prev.is_alive():
            raise PreviousJobStillRunningError(
                f"Previous job thread did not finish within {_JOIN_TIMEOUT}s"
            )


def _run_subprocess_job(
    ws: WorkspaceState,
    job: Job,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster,
) -> None:
    """Run a job via subprocess and update workspace state (H-0036)."""
    from lizystudio.services.subprocess_runner import run_job_in_subprocess
    from lizystudio.services.workspace import get_backend_name

    if ws.data_ref is None or not ws.data_ref.path:
        job.status = "failed"
        job.error = "No data loaded — cannot run subprocess job"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
        if broadcaster is not None:
            broadcaster.send_error(job.job_id, job.error)
        with ws._lock:
            ws.current_job_id = job.job_id
        return
    data_path = ws.data_ref.path
    finished = run_job_in_subprocess(
        job=job,
        job_store=job_store,
        broadcaster=broadcaster,
        backend_name=get_backend_name(ws),
        data_path=data_path,
    )
    with ws._lock:
        ws.workspace_fit_result = finished.fit_result
        ws.workspace_tune_result = finished.tune_result
        ws.current_job_id = finished.job_id


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

    from lizystudio.services.openmp_detect import should_use_subprocess

    use_subprocess = should_use_subprocess()

    def _run() -> None:
        if use_subprocess:
            _run_subprocess_job(ws, job, job_store, broadcaster)
        else:
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

    from lizystudio.services.openmp_detect import should_use_subprocess

    use_subprocess = should_use_subprocess()

    def _run() -> None:
        if use_subprocess:
            _run_subprocess_job(ws, job, job_store, broadcaster)
        else:
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
