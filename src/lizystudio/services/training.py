"""Training service — run fit/tune jobs (BLUEPRINT §4.2.4, H-0002 B, H-0011).

Provides both synchronous `run_fit`/`run_tune` and async launcher helpers
`start_fit_async`/`start_tune_async` that handle thread creation and
workspace state updates (Phase 29 — Router must NOT own threads).

Shared lifecycle primitives (``_run_job_core``, ``_run_subprocess_job``,
progress callbacks, pickle preflight, etc.) live in
:mod:`lizystudio.services._training_core` as of the A-3 extraction.
Historical names are re-exported from this module for backwards
compatibility with callers such as the lizyml adapter's
``CancelledError`` lookup.
"""

from __future__ import annotations

import copy
import logging
import threading
from typing import TYPE_CHECKING, Any

from lizystudio.backends.base import BackendAdapter, ProgressCallback
from lizystudio.backends.types import FitSummary, TuningSummary
from lizystudio.services._training_core import (  # noqa: F401
    _JOIN_TIMEOUT,
    CancelledError,
    PreviousJobStillRunningError,
    _emit_terminal_metric,
    _join_previous_thread,
    _make_cancel_aware_cb,
    _prepare_autofit_config,
    _run_job_core,
    _run_pickle_preflight,
    _run_subprocess_job,
    _save_tuning_plot,
    _subprocess_duration_seconds,
)
from lizystudio.services.jobs import Job, JobStore

if TYPE_CHECKING:
    from lizystudio.services.workspace import WorkspaceState
    from lizystudio.ws.progress import ProgressBroadcaster

_logger = logging.getLogger(__name__)


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

    # Resolve direction from evaluation metrics. Bug 2026-04-14: the
    # previous ``"direction" not in params`` guard let stale / wrong
    # values pass through unchanged. The workspace inject path used to
    # hardcode ``direction: minimize`` and old persisted configs from a
    # broken state could carry a direction that no longer matches the
    # evaluation metric. We now ALWAYS recompute the natural direction
    # from the optimization metric and overwrite when it disagrees,
    # using ``maximize_metrics`` as the single source of truth.
    if "tuning" in result:
        optuna = result["tuning"].get("optuna", {})
        params = optuna.get("params", {})
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
            correct_direction = (
                "maximize" if first_metric in maximize_metrics else "minimize"
            )
            if params.get("direction") != correct_direction:
                optuna["params"] = {**params, "direction": correct_direction}
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
    _run_pickle_preflight(backend, checkpoint_dir)

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
            ws.record_completion(
                fit_result=finished.fit_result,
                tune_result=None,
                job_id=finished.job_id,
            )

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    ws.register_job_thread(t)
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
            ws.record_completion(
                fit_result=finished.fit_result,
                tune_result=finished.tune_result,
                job_id=finished.job_id,
            )

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    ws.register_job_thread(t)
    return job.job_id


# ---------------------------------------------------------------------------
# Re-tune / Resume launcher (H-0062)
# ---------------------------------------------------------------------------
# Implementation moved to ``training_retune.py`` as part of the H-0062
# cleanup file split. Re-exported here so existing
# ``from lizystudio.services.training import start_retune_async, run_retune``
# call sites continue to work without churn.

from lizystudio.services.training_retune import (  # noqa: E402, F401
    _copy_checkpoint_to_child,
    _mark_retune_child_failed,
    _run_retune_subprocess,
    run_retune,
    start_retune_async,
)

# Public API surface: only symbols meant for external import.  The
# private names (``_run_job_core``, ``_JOIN_TIMEOUT``, etc.) remain
# reachable through this module for backwards compatibility with
# pre-existing tests and the lizyml adapter, but are intentionally
# omitted from ``__all__`` so ``from lizystudio.services.training
# import *`` does not leak them.
__all__ = [
    "CancelledError",
    "PreviousJobStillRunningError",
    "run_fit",
    "run_retune",
    "run_tune",
    "start_fit_async",
    "start_retune_async",
    "start_tune_async",
]
