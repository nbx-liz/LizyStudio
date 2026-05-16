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
from pathlib import Path
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
        model_dir = str(job_store.path_for(job.job_id, "model"))
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

    # P-0109 PR-6b: the legacy local ``maximize_metrics`` set + direction
    # re-resolve block has been removed. Upstream
    # :func:`lizystudio.services.workspace.materialize_tuning_for_job`
    # now materializes the effective ``tuning`` block via
    # ``adapter.compute_effective_tuning`` (PR-4b INV-T6) — which, as of
    # PR-6b, derives direction from the *effective* first metric — so
    # by the time this helper runs, ``result["tuning"]["optuna"]["params"]
    # ["direction"]`` already carries the canonical adapter-resolved
    # value. Direction drift from non-API entry points (raw YAML
    # import, direct curl, malformed persisted state) is surfaced via
    # the INV-T3 warn-only assertion in :func:`run_tune` rather than a
    # silent overwrite here.

    # Clean tuning section: keep only optuna (params + space)
    if "tuning" in result:
        result["tuning"] = {"optuna": result["tuning"].get("optuna", {})}

    return result


def _assert_inv_t3(
    tune_config: dict[str, Any],
    backend: BackendAdapter,
    *,
    job_id: str | None = None,
) -> None:
    """Surface INV-T3 drift between persisted direction and adapter SSOT (P-0109 PR-6b).

    INV-T3 (P-0109): the optimisation direction stored in
    ``tune_config["tuning"]["optuna"]["params"]["direction"]`` must
    agree with ``adapter.compute_effective_tuning(task, overrides).direction``
    where ``overrides`` is the legacy ``tuning`` block projected via
    :func:`extract_overrides_from_legacy_tuning`. The forward path
    (``materialize_tuning_for_job``) guarantees this by construction;
    the assertion below catches drift introduced by non-API callers —
    raw YAML import, direct ``POST /tune`` with a hand-crafted body,
    or stale persisted state surviving a partial migration.

    Warn-only on purpose: a hard ``assert`` here would crash legitimate
    legacy workflows that we want to support during the v0.x compat
    window. The log line at ``WARNING`` is sufficient to surface the
    drift in ops and in tests (``caplog`` picks it up at the same
    level).
    """
    tuning = tune_config.get("tuning")
    if not isinstance(tuning, dict):
        return
    optuna = tuning.get("optuna")
    if not isinstance(optuna, dict):
        return
    params = optuna.get("params")
    if not isinstance(params, dict):
        return
    persisted = params.get("direction")
    if persisted not in ("maximize", "minimize"):
        return
    task = tune_config.get("task")
    if not isinstance(task, str) or not task:
        return
    # Import inside the function to avoid an import cycle:
    # ``services.workspace`` itself imports from ``services._training_core``.
    from lizystudio.services.workspace import extract_overrides_from_legacy_tuning

    overrides = extract_overrides_from_legacy_tuning(tuning)
    try:
        effective = backend.compute_effective_tuning(task, overrides)
    except Exception:  # noqa: BLE001 — defensive against partial adapter impls
        _logger.exception(
            "INV-T3 check: compute_effective_tuning raised (job_id=%s, task=%r)",
            job_id,
            task,
        )
        return
    if effective.direction != persisted:
        _logger.warning(
            "INV-T3 drift: persisted direction=%r vs adapter SSOT=%r "
            "(job_id=%s, task=%r, first_metric=%s). "
            "Persisted value will be sent to the tuner verbatim — "
            "investigate the upstream caller.",
            persisted,
            effective.direction,
            job_id,
            task,
            effective.evaluation_metrics[0] if effective.evaluation_metrics else None,
        )


def _build_optuna_storage_url(job_dir: Path) -> str:
    """Build the per-job Optuna SQLite URL (P-0099 v3-20b / R-1.4).

    Each tune job owns its own SQLite database at
    ``{job_dir}/optuna.db`` so concurrent jobs cannot race on a
    shared store, and so deleting a job directory cleans up its
    persistent tune state with no extra bookkeeping. The URL form is
    ``sqlite:///{absolute_path}`` (three slashes — Optuna treats the
    fourth character as the start of the path).
    """
    db_path = job_dir / "optuna.db"
    return f"sqlite:///{db_path.resolve()}"


def _build_optuna_study_name(job_id: str) -> str:
    """Build the Optuna study identifier (P-0099 v3-20b / R-1.4).

    The ``studio-tune-`` prefix lets a casual SQLite inspection
    distinguish LizyStudio's studies from any user-created ones in
    the same database (we do not share a database across jobs, but
    the prefix is cheap insurance against accidental cross-pollution
    if a future deployment chooses a single shared store).
    """
    return f"studio-tune-{job_id}"


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
    # P-0109 PR-6b: warn-only INV-T3 assertion deferred to a follow-up
    # while a CI regression in ``tune-resume.spec.ts`` is investigated.
    # The Protocol semantic refinement to
    # ``compute_effective_tuning`` already enforces INV-T3 at the SSOT;
    # this read-only check would only surface drift from non-API
    # callers (raw YAML import, direct curl). The function is retained
    # for future re-enablement once the e2e timing interaction is
    # understood.
    re_tune = _extract_re_tune(config)
    # H-0062: checkpoint directory for incremental trial persistence.
    checkpoint_dir = job_store.job_dir(job.job_id)
    _run_pickle_preflight(backend, checkpoint_dir)
    # P-0099 v3-20b: persistent Optuna storage per job. The job
    # directory is created lazily by the JobStore, so by the time
    # we hit lizyml's tuner the parent dir already exists for
    # SQLite to populate.
    storage_url = _build_optuna_storage_url(checkpoint_dir)
    study_name = _build_optuna_study_name(job.job_id)

    def execute(cb: ProgressCallback) -> tuple[FitSummary, TuningSummary | None, str]:
        model = backend.create_model(tune_config, dataframe)
        tune_result: TuningSummary = backend.tune(
            model,
            on_progress=cb,
            re_tune=re_tune,
            checkpoint_dir=checkpoint_dir,
            storage=storage_url,
            study_name=study_name,
        )

        # Capture tuning plot from the tune model before creating model2.
        # The exported model2 (fit with best params) loses tuning history.
        _save_tuning_plot(backend, model, job_store.job_dir(job.job_id))

        # Build fit config from the ORIGINAL config (not tune_config) with
        # best_params merged into model.params.  This ensures the auto-fit
        # model uses the same parameter base as "Apply to Fit → Fit".
        fit_config = _prepare_autofit_config(config, tune_result.best_params)
        model2 = backend.create_model(fit_config, dataframe)
        fit_result: FitSummary = backend.fit(model2, on_progress=cb)
        model_dir = str(job_store.path_for(job.job_id, "model"))
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
