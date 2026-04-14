"""Re-tune / Resume launcher service (H-0062 Phase B).

Extracted from ``training.py`` (H-0062 cleanup) so the retune-specific
helpers can evolve without inflating the shared training module.

Public entry points:
- ``run_retune`` -- synchronous execution body shared by both the thread
  and subprocess paths.
- ``start_retune_async`` -- background launcher used by the API layer.

Internal helpers (``_copy_checkpoint_to_child``,
``_mark_retune_child_failed``, ``_run_retune_subprocess``) are kept as
module-private functions and are not part of the public surface.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from lizystudio.backends.base import BackendAdapter, ProgressCallback
from lizystudio.backends.types import FitSummary, TuningSummary
from lizystudio.services.jobs import Job, JobStore
from lizystudio.services.training import (
    _join_previous_thread,
    _prepare_autofit_config,
    _run_job_core,
    _run_pickle_preflight,
    _save_tuning_plot,
)

if TYPE_CHECKING:
    from lizystudio.services.workspace import WorkspaceState
    from lizystudio.ws.progress import ProgressBroadcaster

_logger = logging.getLogger(__name__)


def _copy_checkpoint_to_child(parent_dir: Path, child_dir: Path) -> None:
    """Copy the parent's model.pkl and model_meta.json into the child dir."""
    import shutil

    child_dir.mkdir(parents=True, exist_ok=True)
    for filename in ("model.pkl", "model_meta.json"):
        src = parent_dir / filename
        if src.exists():
            shutil.copy2(src, child_dir / filename)


def run_retune(
    *,
    parent_job: Job,
    child_job: Job,
    job_store: JobStore,
    backend: BackendAdapter,
    dataframe: Any,
    n_trials: int,
    expand_boundary: bool | None,
    boundary_threshold: float | None,
    broadcaster: ProgressBroadcaster | None = None,
) -> Job:
    """Execute a Re-tune / Resume child job (H-0062).

    Copies the parent's ``model.pkl`` into the child's job directory,
    loads it via the adapter's ``load_checkpoint``, then calls
    ``backend.tune`` with a ``re_tune`` override so the Optuna study is
    continued for the requested n_trials. Subsequent trials are saved
    back to the child's own checkpoint via the standard bridge callback.
    """
    parent_dir = job_store.jobs_dir / parent_job.job_id
    child_dir = job_store.jobs_dir / child_job.job_id
    _copy_checkpoint_to_child(parent_dir, child_dir)
    _run_pickle_preflight(child_dir)

    def execute(
        cb: ProgressCallback,
    ) -> tuple[FitSummary, TuningSummary | None, str]:
        model = backend.load_checkpoint(child_dir)
        # H-0062: single-round resume. We pass resume=True so the loaded
        # Optuna study is continued for the requested n_trials instead
        # of being thrown away. n_trials and the boundary-expand kwargs
        # are applied to the FIRST round (which is the only round here).
        re_tune_block: dict[str, Any] = {
            "n_rounds": 1,
            "n_trials": n_trials,
        }
        if expand_boundary is not None:
            re_tune_block["expand_boundary"] = expand_boundary
        if boundary_threshold is not None:
            re_tune_block["boundary_threshold"] = boundary_threshold

        tune_result: TuningSummary = backend.tune(
            model,
            on_progress=cb,
            re_tune=re_tune_block,
            checkpoint_dir=child_dir,
            resume=True,
        )

        _save_tuning_plot(backend, model, child_dir)

        fit_config = _prepare_autofit_config(child_job.config, tune_result.best_params)
        model2 = backend.create_model(fit_config, dataframe)
        fit_result: FitSummary = backend.fit(model2, on_progress=cb)
        model_dir = str(child_dir / "model")
        backend.export_model(model2, model_dir)
        return fit_result, tune_result, model_dir

    return _run_job_core(
        job=child_job,
        job_store=job_store,
        broadcaster=broadcaster,
        execute_fn=execute,
    )


def _mark_retune_child_failed(
    *,
    ws: WorkspaceState,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster | None,
    child_job: Job,
    message: str,
) -> None:
    """Mark *child_job* as failed and wire the workspace to surface it.

    Shared between the pre-spawn guards in ``start_retune_async`` and
    the worker-thread guard in ``_run_retune_subprocess``. H-0062
    Bugfix 2026-04-14 (6): previously the subprocess helper used
    ``assert``, which raised ``AssertionError`` inside the worker
    thread and left the child in ``pending`` forever (no status
    transition, no broadcaster error). Using a shared helper ensures
    both failure paths go through the same state transitions.
    """
    child_job.status = "failed"
    child_job.error = message
    child_job.completed_at = datetime.now(timezone.utc).isoformat()
    job_store.update(child_job)
    with ws._lock:
        ws.current_job_id = child_job.job_id
    if broadcaster is not None:
        broadcaster.send_error(child_job.job_id, message)


def _run_retune_subprocess(
    *,
    ws: WorkspaceState,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster | None,
    parent_job: Job,
    child_job: Job,
    n_trials: int,
    expand_boundary: bool | None,
    boundary_threshold: float | None,
) -> Job:
    """Execute a Re-tune child job in a subprocess (H-0062 Bugfix 2026-04-14).

    The parent thread cannot run lizyml / LightGBM because OpenMP would
    bind its thread pool to the daemon thread and cause ~8-50× slowdown
    (see ``openmp_detect.should_use_subprocess``). Mirrors the path used
    by ``start_fit_async`` / ``start_tune_async`` but forwards the
    Re-tune specific inputs so the child process can reconstruct the
    run without accessing the parent's in-memory WorkspaceState.

    The caller (``start_retune_async``) is responsible for guaranteeing
    ``ws.data_ref.path`` is set before invoking this helper. Bugfix
    2026-04-14 (6): previously this used ``assert`` which left the
    child job in ``pending`` forever when the invariant was violated.
    Now a runtime check marks the child failed via the shared helper.
    """
    from lizystudio.services.subprocess_runner import run_job_in_subprocess
    from lizystudio.services.workspace import get_backend_name

    if ws.data_ref is None or not ws.data_ref.path:
        _mark_retune_child_failed(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            child_job=child_job,
            message=(
                "subprocess retune requires a file-backed dataset "
                "(ws.data_ref.path is empty)"
            ),
        )
        return child_job

    finished = run_job_in_subprocess(
        job=child_job,
        job_store=job_store,
        broadcaster=broadcaster,
        backend_name=get_backend_name(ws),
        data_path=ws.data_ref.path,
        mode="retune",
        parent_job_id=parent_job.job_id,
        retune_n_trials=n_trials,
        retune_expand_boundary=expand_boundary,
        retune_boundary_threshold=boundary_threshold,
    )
    with ws._lock:
        ws.workspace_fit_result = finished.fit_result
        ws.workspace_tune_result = finished.tune_result
        ws.current_job_id = finished.job_id
    return finished


def start_retune_async(
    *,
    ws: WorkspaceState,
    job_store: JobStore,
    broadcaster: ProgressBroadcaster,
    parent_job: Job,
    child_job: Job,
    n_trials: int,
    expand_boundary: bool | None,
    boundary_threshold: float | None,
    mode: Literal["retune", "resume"],
) -> str:
    """Spawn a background thread for Re-tune / Resume (H-0062).

    Holds a per-parent lock that was already acquired by the API layer
    and releases it when the child thread finishes regardless of
    success / failure. The *mode* string is used in log messages to
    distinguish the two semantic cases even though they share the
    same code path.

    When ``should_use_subprocess()`` is True (i.e. OpenMP is present),
    the actual Re-tune work runs in a child process to avoid the
    daemon-thread OpenMP thread-pool bind that causes ~8-50× slowdown.
    Discovered as H-0062 Bugfix 2026-04-14 after the initial implementation
    was thread-only and observed 1 trial / ~40s instead of ~5s on Titanic.
    """
    from lizystudio.services.openmp_detect import should_use_subprocess

    _join_previous_thread(ws)

    use_subprocess = should_use_subprocess()

    def _fail_inline(message: str) -> str:
        # Early-fail path: delegate state transitions to the shared
        # helper, then also release the parent lock (which only makes
        # sense in the inline path -- the async worker thread releases
        # via its own finally block).
        _mark_retune_child_failed(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            child_job=child_job,
            message=message,
        )
        job_store.release_parent_lock(parent_job.job_id)
        return child_job.job_id

    if ws.dataframe is None:
        return _fail_inline("No data loaded in workspace; cannot re-tune")

    if use_subprocess and (ws.data_ref is None or not ws.data_ref.path):
        # Subprocess path reads the dataframe from disk in the child,
        # so an in-memory-only dataset (data_ref.path empty) cannot be
        # re-tuned under OpenMP without first being saved. Surface it
        # explicitly rather than silently downgrading to the thread
        # path, since the thread path would still be ~8x slower and
        # the user would blame the retune itself.
        return _fail_inline(
            "Re-tune requires a file-backed dataset when OpenMP is active; "
            "please re-upload or save the current data before retrying"
        )

    dataframe = ws.dataframe

    def _run() -> None:
        # H-0062: always point the workspace at the child so a failed /
        # cancelled / crashed retune still surfaces through the Workspace
        # Results Panel instead of leaving the selection on the parent.
        with ws._lock:
            ws.current_job_id = child_job.job_id
        try:
            if use_subprocess:
                _run_retune_subprocess(
                    ws=ws,
                    job_store=job_store,
                    broadcaster=broadcaster,
                    parent_job=parent_job,
                    child_job=child_job,
                    n_trials=n_trials,
                    expand_boundary=expand_boundary,
                    boundary_threshold=boundary_threshold,
                )
            else:
                finished = run_retune(
                    parent_job=parent_job,
                    child_job=child_job,
                    job_store=job_store,
                    backend=ws.backend,
                    dataframe=dataframe,
                    n_trials=n_trials,
                    expand_boundary=expand_boundary,
                    boundary_threshold=boundary_threshold,
                    broadcaster=broadcaster,
                )
                with ws._lock:
                    ws.workspace_fit_result = finished.fit_result
                    ws.workspace_tune_result = finished.tune_result
                    ws.current_job_id = finished.job_id
        except Exception as exc:  # noqa: BLE001
            # H-0062 Bugfix 2026-04-14 (6): any unexpected exception
            # inside the worker thread must still transition the child
            # to `failed` and notify the broadcaster. Without this
            # blanket catch, an assertion error or programming bug
            # leaves the child `pending` forever.
            _logger.exception(
                "event='retune.worker_crash' mode=%s parent=%s child=%s",
                mode,
                parent_job.job_id,
                child_job.job_id,
            )
            # Only mark failed if the child has not already been
            # transitioned (run_retune / _run_job_core may have done so).
            refreshed = job_store.get(child_job.job_id)
            if refreshed is None or refreshed.status in ("pending", "running"):
                _mark_retune_child_failed(
                    ws=ws,
                    job_store=job_store,
                    broadcaster=broadcaster,
                    child_job=child_job,
                    message=f"retune worker crashed: {exc}",
                )
        finally:
            # Always release the per-parent lock, even when run_retune
            # raised (cancellation, pickle mismatch, etc.).
            job_store.release_parent_lock(parent_job.job_id)
            _logger.info(
                "event='retune.finished' mode=%s parent=%s child=%s",
                mode,
                parent_job.job_id,
                child_job.job_id,
            )

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    with ws._lock:
        ws._job_thread = t
    return child_job.job_id
