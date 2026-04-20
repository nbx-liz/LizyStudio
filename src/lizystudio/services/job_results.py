"""Job-result dispatch helpers — transforms Job + BackendAdapter → result data.

Split out of ``services/jobs.py`` as part of the A-7 coupling-refactor
(see docs/coupling-analysis.md). ``jobs.py`` owns disk CRUD; this module
owns adapter dispatch and memoizes ``load_model`` results so consecutive
calls for the same completed job skip a repeated disk read + deserialize.

The cache is keyed by ``(backend_name, model_path)`` rather than by job
identity because different jobs can legitimately share a model path
(e.g. Re-tune children that export under a parent directory) and because
the same path deserializes identically regardless of which Job instance
asked for it. Invalidate via :func:`clear_model_cache` when a path is
overwritten.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.types import PlotData
from lizystudio.services.jobs import Job

_MODEL_CACHE_MAX = 8

_model_cache: OrderedDict[tuple[str, str], Any] = OrderedDict()
_model_cache_lock = threading.Lock()


def clear_model_cache() -> None:
    """Drop all memoized models. Call after a path is overwritten."""
    with _model_cache_lock:
        _model_cache.clear()


def clear_model_cache_for(model_path: str) -> None:
    """Drop cached entries for a specific model path across all backends."""
    with _model_cache_lock:
        stale = [k for k in _model_cache if k[1] == model_path]
        for key in stale:
            del _model_cache[key]


def load_job_model(job: Job, backend: BackendAdapter) -> Any:
    """Load a trained model from a completed job, memoized in an LRU cache.

    The cache critical section wraps the adapter ``load_model`` call so a
    concurrent :func:`clear_model_cache_for` invalidation cannot interleave
    between "cache miss" and "write result" and resurrect a path that was
    meant to be dropped. The per-process cache is small (``maxsize=8``) and
    model deserialization is fast enough that a single lock is simpler than
    a per-key Event barrier.
    """
    if job.model_path is None:
        msg = f"Job {job.job_id} has no saved model"
        raise ValueError(msg)

    key = (job.backend_name, job.model_path)
    with _model_cache_lock:
        if key in _model_cache:
            _model_cache.move_to_end(key)
            return _model_cache[key]

        model = backend.load_model(job.model_path)
        _model_cache[key] = model
        _model_cache.move_to_end(key)
        while len(_model_cache) > _MODEL_CACHE_MAX:
            _model_cache.popitem(last=False)
        return model


def get_metrics_table(job: Job, backend: BackendAdapter) -> list[dict[str, Any]]:
    """Get the metrics evaluation table for a completed job."""
    model = load_job_model(job, backend)
    return backend.evaluate_table(model)


def get_split_summary(job: Job, backend: BackendAdapter) -> list[dict[str, Any]]:
    """Get fold/split summary for a completed job."""
    model = load_job_model(job, backend)
    return backend.split_summary(model)


def get_importance(
    job: Job, backend: BackendAdapter, kind: str = "split"
) -> dict[str, float]:
    """Get feature importance for a completed job."""
    model = load_job_model(job, backend)
    return backend.importance(model, kind=kind)


def get_importance_kinds(job: Job, backend: BackendAdapter) -> list[str]:
    """Get the list of valid importance kind identifiers for a completed job."""
    model = load_job_model(job, backend)
    return backend.importance_kinds(model)


def get_learning_curve_metrics(job: Job, backend: BackendAdapter) -> list[str]:
    """Get the list of metric names available in the learning curve history."""
    model = load_job_model(job, backend)
    return backend.learning_curve_metrics(model)


def _get_jobs_dir(job: Job) -> Path | None:
    """Derive the jobs directory from a job's model_path."""
    if job.model_path:
        return Path(job.model_path).parent.parent
    return None


def _load_tuning_plot_from_file(job: Job) -> PlotData | None:
    """Load a saved tuning plot JSON from disk (fallback for exported models)."""
    jobs_dir = _get_jobs_dir(job)
    if jobs_dir is None:
        return None
    path = jobs_dir / job.job_id / "tuning_plot.json"
    if not path.exists():
        return None
    return PlotData(plotly_json=path.read_text(encoding="utf-8"))


def get_job_plot(
    job: Job, backend: BackendAdapter, plot_type: str, **kwargs: Any
) -> Any:
    """Get a plot for a completed job. Returns PlotData."""
    model = load_job_model(job, backend)
    if plot_type == "tuning":
        try:
            return backend.plot(model, plot_type, **kwargs)
        except Exception:  # noqa: BLE001
            saved = _load_tuning_plot_from_file(job)
            if saved is not None:
                return saved
            raise
    return backend.plot(model, plot_type, **kwargs)


def get_available_plots(job: Job, backend: BackendAdapter) -> list[str]:
    """Get list of available plot types for a completed job."""
    model = load_job_model(job, backend)
    plots = list(backend.available_plots(model))
    if "tuning" not in plots and job.job_type == "tune":
        saved = _load_tuning_plot_from_file(job)
        if saved is not None:
            plots.append("tuning")
    return plots
