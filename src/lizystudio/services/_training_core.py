"""Shared training-core helpers (A-3 extraction).

Both :mod:`lizystudio.services.training` (fit/tune) and
:mod:`lizystudio.services.training_retune` (retune/resume) need the
same primitives: the cancel-aware progress callback, the job lifecycle
wrapper (``_run_job_core``), the subprocess orchestrator, plus a
handful of utility helpers. Previously the two modules shared them by
having ``training_retune`` import private symbols from ``training`` —
which introduced a logical cycle that was patched with a lazy
``from lizystudio.services.training import _run_subprocess_job``.

This module owns those primitives so neither side imports from the
other. ``training.py`` re-exports the historical names for backwards
compatibility with callers that still reach for
``from lizystudio.services.training import CancelledError`` or
``_run_job_core``.
"""

from __future__ import annotations

import copy
import io
import logging
import time
import traceback
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from lizystudio.backends.base import BackendAdapter, ProgressCallback
from lizystudio.backends.types import FitSummary, TuningSummary
from lizystudio.metrics import record_job_terminal
from lizystudio.services.jobs import Job, JobStore

if TYPE_CHECKING:
    from lizystudio.services.workspace import WorkspaceState
    from lizystudio.ws.progress import ProgressBroadcaster

_logger = logging.getLogger(__name__)

_JOIN_TIMEOUT = 30  # seconds — generous to allow subprocess cleanup


# Re-exported from :mod:`lizystudio.backends.exceptions` (H-0068) so
# the service and backend layers catch the exact same class.  Keeping
# the name importable here preserves ``except CancelledError`` catches
# scattered through training code and tests without an identity break.
from lizystudio.backends.exceptions import CancelledError  # noqa: E402, F401


class PreviousJobStillRunningError(Exception):
    """Raised when a previous job thread is still alive after join timeout."""


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


def _subprocess_duration_seconds(job: Job) -> float:
    """Compute wall-clock duration from a subprocess-owned job.

    H-0066: the subprocess child stamps both ``created_at`` and
    ``completed_at`` in ISO-8601. The parent cannot share the thread-
    mode ``time.monotonic()`` baseline, so this helper reconstructs
    the elapsed seconds from the persisted timestamps.

    Returns 0.0 when either timestamp is missing / unparseable — safer
    than propagating an exception through the finally-block.
    """
    if job.completed_at is None:
        return 0.0
    try:
        created = datetime.fromisoformat(job.created_at)
        completed = datetime.fromisoformat(job.completed_at)
    except ValueError:
        return 0.0
    return max(0.0, (completed - created).total_seconds())


def _emit_terminal_metric(job: Job, duration: float = 0.0) -> None:
    """Bump ``lizystudio_jobs_total`` and observe duration (H-0065, H-0066).

    Centralises the per-literal dispatch that mypy requires for Literal
    narrowing.
    """
    if job.status == "completed":
        record_job_terminal(job.job_type, "completed", duration=duration)
    elif job.status == "failed":
        record_job_terminal(job.job_type, "failed", duration=duration)
    elif job.status == "cancelled":
        record_job_terminal(job.job_type, "cancelled", duration=duration)


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
    """Shared execution wrapper for fit / tune / retune jobs.

    Handles status transitions, log capture, error handling, and
    persistence.
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
        record_job_terminal(job.job_type, "failed")
        return job

    job.status = "running"
    job_store.update(job)

    # H-0066: wall-clock start for the duration histogram.
    start_time = time.monotonic()

    cb = _make_cancel_aware_cb(job.job_id, job_store, broadcaster)

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
        job.error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
        if broadcaster is not None:
            safe_msg = f"{type(exc).__name__}: {exc}"
            broadcaster.send_error(job.job_id, safe_msg)
    finally:
        job_store.release_active(job.job_id)
        job_store.clear_cancel(job.job_id)
        elapsed = time.monotonic() - start_time
        _emit_terminal_metric(job, duration=elapsed)  # H-0065 / H-0066
        job_logger.removeHandler(handler)
        handler.close()
        # Persist captured logs. OSError here must not propagate —
        # doing so would short-circuit the worker thread and leave a
        # zombie thread handle on the workspace.
        try:
            log_path = job_store.path_for(job.job_id, "log")
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_path.write_text(log_buffer.getvalue(), encoding="utf-8")
        except OSError:
            _logger.warning(
                "Failed to persist execution log for job %s",
                job.job_id,
                exc_info=True,
            )

    return job


def _save_tuning_plot(
    backend: BackendAdapter,
    model: Any,
    job_dir: Path,
) -> None:
    """Persist the tuning plot JSON so it survives model export (H-0002 B)."""
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
    """Build a fit-ready config from the original config + best_params."""
    result = copy.deepcopy(config)
    model = dict(result.get("model", {}))
    existing_params = dict(model.get("params", {}))
    model["params"] = {**existing_params, **best_params}
    result["model"] = model
    result.pop("tuning", None)
    return result


def _run_pickle_preflight(backend: BackendAdapter, job_dir: Path) -> None:
    """Run the H-0062 pre-flight check before tune launches (H-0068).

    Delegates to the adapter's :meth:`preflight_checkpoint_dir` so this
    service module never imports backend-specific symbols; translates
    the common :class:`CheckpointPreflightError` into the HTTP-facing
    :class:`PicklePreflightFailedError` envelope.
    """
    from lizystudio.api.errors import PicklePreflightFailedError
    from lizystudio.backends.exceptions import CheckpointPreflightError

    try:
        backend.preflight_checkpoint_dir(job_dir)
    except CheckpointPreflightError as exc:
        raise PicklePreflightFailedError(str(exc)) from exc


def _join_previous_thread(ws: WorkspaceState) -> None:
    """Join the previous job thread if it exists (H-0040).

    Prevents thread/OpenMP thread-pool accumulation by ensuring the prior
    worker is cleaned up before spawning a new one.

    Raises :class:`PreviousJobStillRunningError` if the thread does not
    finish within ``_JOIN_TIMEOUT`` seconds.

    The lock is intentionally released before ``join`` so a new thread
    can be registered concurrently — holding it across a 30-second join
    would serialize every /fit and /tune request.  The trade-off is a
    non-atomic read-then-act window: if another request registers a new
    thread during our join, we still join the one we observed (which is
    correct — the caller's only goal is to avoid spawning on top of a
    live predecessor).
    """
    prev = ws.previous_job_thread()
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
    broadcaster: ProgressBroadcaster | None,
    *,
    mode: str | None = None,
    parent_job_id: str | None = None,
    retune_n_trials: int | None = None,
    retune_expand_boundary: bool | None = None,
    retune_boundary_threshold: float | None = None,
    on_data_missing: Callable[[Job], None] | None = None,
) -> Job:
    """Run a job via subprocess and update workspace state.

    Shared by fit, tune, and retune subprocess paths.
    """
    from lizystudio.services.subprocess_runner import run_job_in_subprocess
    from lizystudio.services.workspace import get_backend_name

    terminal_already_recorded = False
    try:
        if ws.data_ref is None or not ws.data_ref.path:
            if on_data_missing is not None:
                on_data_missing(job)
                terminal_already_recorded = True
            else:
                job.status = "failed"
                job.error = "No data loaded — cannot run subprocess job"
                job.completed_at = datetime.now(timezone.utc).isoformat()
                job_store.update(job)
                if broadcaster is not None:
                    broadcaster.send_error(job.job_id, job.error)
                ws.note_current_job(job.job_id)
                record_job_terminal(job.job_type, "failed")
                terminal_already_recorded = True
            return job
        data_path = ws.data_ref.path
        extra_kwargs: dict[str, Any] = {}
        if mode is not None:
            extra_kwargs["mode"] = mode
        if parent_job_id is not None:
            extra_kwargs["parent_job_id"] = parent_job_id
        if retune_n_trials is not None:
            extra_kwargs["retune_n_trials"] = retune_n_trials
        if retune_expand_boundary is not None:
            extra_kwargs["retune_expand_boundary"] = retune_expand_boundary
        if retune_boundary_threshold is not None:
            extra_kwargs["retune_boundary_threshold"] = retune_boundary_threshold
        finished = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name=get_backend_name(ws),
            data_path=data_path,
            **extra_kwargs,
        )
        ws.record_completion(
            fit_result=finished.fit_result,
            tune_result=finished.tune_result,
            job_id=finished.job_id,
        )
        return finished
    finally:
        job_store.release_active(job.job_id)
        # H-0065 / H-0066: subprocess child writes the terminal status
        # on disk; re-read it here so the parent emits exactly one
        # counter increment per job in either mode.
        if not terminal_already_recorded:
            latest = job_store.get(job.job_id)
            if latest is not None:
                duration = _subprocess_duration_seconds(latest)
                _emit_terminal_metric(latest, duration=duration)


__all__ = [
    "CancelledError",
    "PreviousJobStillRunningError",
    "_JOIN_TIMEOUT",
    "_emit_terminal_metric",
    "_join_previous_thread",
    "_make_cancel_aware_cb",
    "_prepare_autofit_config",
    "_run_job_core",
    "_run_pickle_preflight",
    "_run_subprocess_job",
    "_save_tuning_plot",
    "_subprocess_duration_seconds",
]
