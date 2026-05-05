"""Job-result dispatch helpers — transforms Job + BackendAdapter → result data.

Split out of ``services/jobs.py`` as part of the A-7 coupling-refactor
(see docs/coupling-analysis.md). ``jobs.py`` owns disk CRUD; this module
owns adapter dispatch and memoizes ``load_model`` results so consecutive
calls for the same completed job skip a repeated disk read + deserialize.

The cache is keyed by ``(backend_name, model_path)`` rather than by job
identity because different jobs can legitimately share a model path
(e.g. Re-tune children that export under a parent directory) and because
the same path deserializes identically regardless of which Job instance
asked for it. Invalidate via :meth:`ModelCache.clear_for` when a path is
overwritten.

H-0084 (Issue #235): the cache lives on a :class:`ModelCache` instance
owned by ``JobStore`` rather than at module scope, so two apps sharing
a process do not cross-contaminate each other. See the History entry
H-0084 for the invariants and the migration trade-off.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.types import PlotData
from lizystudio.services.jobs import Job, artifact_path

MODEL_CACHE_MAX = 8
"""Default maximum number of deserialised models kept per app."""


class ModelCache:
    """LRU cache of deserialised backend models, scoped per ``JobStore``.

    The critical section wraps the adapter ``load_model`` call so a
    concurrent :meth:`clear_for` invalidation cannot interleave between
    "cache miss" and "write result" and resurrect a path that was meant
    to be dropped. The per-app cache is small (``max_size=8`` by default)
    and model deserialisation is fast enough that a single lock is
    simpler than a per-key Event barrier.
    """

    def __init__(self, max_size: int = MODEL_CACHE_MAX) -> None:
        self._entries: OrderedDict[tuple[str, str], Any] = OrderedDict()
        self._lock = threading.Lock()
        self._max_size = max_size

    def load(self, job: Job, backend: BackendAdapter) -> Any:
        """Load a trained model, memoising the result."""
        if job.model_path is None:
            msg = f"Job {job.job_id} has no saved model"
            raise ValueError(msg)

        key = (job.backend_name, job.model_path)
        with self._lock:
            if key in self._entries:
                self._entries.move_to_end(key)
                return self._entries[key]

            model = backend.load_model(job.model_path)
            self._entries[key] = model
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_size:
                self._entries.popitem(last=False)
            return model

    def clear(self) -> None:
        """Drop all memoised models (e.g. after an app-wide rollover)."""
        with self._lock:
            self._entries.clear()

    def clear_for(self, model_path: str) -> None:
        """Drop cached entries for a specific ``model_path`` across all backends."""
        with self._lock:
            stale = [k for k in self._entries if k[1] == model_path]
            for key in stale:
                del self._entries[key]

    def __contains__(self, key: tuple[str, str]) -> bool:
        """Test helper — expose membership checks without the internal dict."""
        with self._lock:
            return key in self._entries


def get_metrics_table(
    job: Job, backend: BackendAdapter, cache: ModelCache
) -> list[dict[str, Any]]:
    """Get the metrics evaluation table for a completed job."""
    model = cache.load(job, backend)
    return backend.evaluate_table(model)


def get_split_summary(
    job: Job, backend: BackendAdapter, cache: ModelCache
) -> list[dict[str, Any]]:
    """Get fold/split summary for a completed job."""
    model = cache.load(job, backend)
    return backend.split_summary(model)


def get_importance(
    job: Job,
    backend: BackendAdapter,
    cache: ModelCache,
    kind: str = "split",
    *,
    top_n: int | None = None,
) -> dict[str, float]:
    """Get feature importance for a completed job.

    ``top_n`` (P-0097) caps the response to the N most important
    features sorted by value descending. ``None`` (the pre-P-0097
    default) returns the full backend response unchanged.
    """
    model = cache.load(job, backend)
    raw = backend.importance(model, kind=kind)
    if top_n is None or top_n >= len(raw):
        return raw
    return _project_top_n(raw, top_n)


def _project_top_n(raw: dict[str, float], top_n: int) -> dict[str, float]:
    """Return the ``top_n`` highest-importance entries, value-desc sorted.

    Stable ordering on ties: first occurrence wins (Python dict iteration
    order is preserved by insertion, ``sorted`` is stable).
    """
    items = sorted(raw.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
    return dict(items)


def get_importance_kinds(
    job: Job, backend: BackendAdapter, cache: ModelCache
) -> list[str]:
    """Get the list of valid importance kind identifiers for a completed job."""
    model = cache.load(job, backend)
    return backend.importance_kinds(model)


def get_learning_curve_metrics(
    job: Job, backend: BackendAdapter, cache: ModelCache
) -> list[str]:
    """Get the list of metric names available in the learning curve history."""
    model = cache.load(job, backend)
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
    path = artifact_path(jobs_dir, job.job_id, "tuning_plot")
    if not path.exists():
        return None
    return PlotData(plotly_json=path.read_text(encoding="utf-8"))


def get_job_plot(
    job: Job,
    backend: BackendAdapter,
    cache: ModelCache,
    plot_type: str,
    **kwargs: Any,
) -> Any:
    """Get a plot for a completed job. Returns PlotData."""
    model = cache.load(job, backend)
    if plot_type == "tuning":
        try:
            return backend.plot(model, plot_type, **kwargs)
        except Exception:  # noqa: BLE001
            saved = _load_tuning_plot_from_file(job)
            if saved is not None:
                return saved
            raise
    return backend.plot(model, plot_type, **kwargs)


def get_available_plots(
    job: Job, backend: BackendAdapter, cache: ModelCache
) -> list[str]:
    """Get list of available plot types for a completed job."""
    model = cache.load(job, backend)
    plots = list(backend.available_plots(model))
    if "tuning" not in plots and job.job_type == "tune":
        saved = _load_tuning_plot_from_file(job)
        if saved is not None:
            plots.append("tuning")
    return plots
