"""Tests for services.job_results — ModelCache + dispatch helpers.

Covers the A-7 split (dispatch helpers that transform a ``Job`` +
``BackendAdapter`` into result data) and the H-0084 refactor
(per-app :class:`ModelCache` owned by :class:`JobStore`). Persistence
tests live in ``test_jobs.py``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef, PlotData
from lizystudio.services.job_results import (
    ModelCache,
    get_available_plots,
    get_importance,
    get_importance_kinds,
    get_job_plot,
    get_learning_curve_metrics,
    get_metrics_table,
    get_split_summary,
)
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )


def _make_completed_job(
    job_store: JobStore, data_ref: DataRef, job_type: str = "fit"
) -> Any:
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=data_ref,
        job_type=job_type,  # type: ignore[arg-type]
    )
    model_dir = job_store.jobs_dir / job.job_id / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    job.model_path = str(model_dir)
    return job


# ---------------------------------------------------------------------------
# ModelCache — error path + LRU semantics (H-0084)
# ---------------------------------------------------------------------------


def test_model_cache_load_raises_when_no_model_path(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """load must raise ValueError when job.model_path is None."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    assert job.model_path is None
    backend = MagicMock()

    with pytest.raises(ValueError, match="no saved model"):
        job_store.model_cache.load(job, backend)


def test_model_cache_load_returns_loaded_model(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "MODEL_OBJ"

    model = job_store.model_cache.load(job, backend)

    assert model == "MODEL_OBJ"
    backend.load_model.assert_called_once_with(job.model_path)


def test_model_cache_caches_by_path_and_backend(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Second call with same (model_path, backend_name) must hit cache."""
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "MODEL_OBJ"

    first = job_store.model_cache.load(job, backend)
    second = job_store.model_cache.load(job, backend)

    assert first is second
    assert backend.load_model.call_count == 1


def test_model_cache_different_backends_do_not_share(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Cache key includes backend_name, so two backends load independently."""
    job_a = _make_completed_job(job_store, sample_data_ref)
    job_b = _make_completed_job(job_store, sample_data_ref)
    job_b.backend_name = "other"

    backend_a = MagicMock()
    backend_a.load_model.return_value = "A"
    backend_b = MagicMock()
    backend_b.load_model.return_value = "B"

    assert job_store.model_cache.load(job_a, backend_a) == "A"
    assert job_store.model_cache.load(job_b, backend_b) == "B"

    job_store.model_cache.load(job_a, backend_a)
    job_store.model_cache.load(job_b, backend_b)

    assert backend_a.load_model.call_count == 1
    assert backend_b.load_model.call_count == 1


def test_model_cache_clear_forces_reload(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"

    job_store.model_cache.load(job, backend)
    job_store.clear_model_cache()
    job_store.model_cache.load(job, backend)

    assert backend.load_model.call_count == 2


def test_job_store_delete_invalidates_model_cache(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Deleting a job drops its cached model so a reused path never returns
    a stale, pre-delete deserialised object (INV-2).
    """
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"

    job_store.model_cache.load(job, backend)
    key = (job.backend_name, job.model_path)
    assert key in job_store.model_cache

    job_store.delete(job.job_id)

    assert key not in job_store.model_cache


def test_model_cache_is_per_app(tmp_path: Path, sample_data_ref: DataRef) -> None:
    """H-0084 INV-1: two JobStore instances do not share model cache."""
    store_a = JobStore(tmp_path / "a" / "jobs")
    store_b = JobStore(tmp_path / "b" / "jobs")
    assert store_a.model_cache is not store_b.model_cache

    job_a = _make_completed_job(store_a, sample_data_ref)
    job_b = _make_completed_job(store_b, sample_data_ref)

    backend_a = MagicMock()
    backend_a.load_model.return_value = "A-model"
    backend_b = MagicMock()
    backend_b.load_model.return_value = "B-model"

    store_a.model_cache.load(job_a, backend_a)
    store_b.model_cache.load(job_b, backend_b)

    # Cache entry visible only in the owning store.
    assert (job_a.backend_name, job_a.model_path) in store_a.model_cache
    assert (job_a.backend_name, job_a.model_path) not in store_b.model_cache
    assert (job_b.backend_name, job_b.model_path) in store_b.model_cache
    assert (job_b.backend_name, job_b.model_path) not in store_a.model_cache

    # Clearing one store must not affect the other.
    store_a.clear_model_cache()
    assert (job_a.backend_name, job_a.model_path) not in store_a.model_cache
    assert (job_b.backend_name, job_b.model_path) in store_b.model_cache


def test_model_cache_load_is_atomic_under_concurrent_reads(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Concurrent callers on the same (backend, path) trigger at most one
    backend.load_model call because the critical section covers both the
    miss-check and the load.
    """
    import threading as _threading

    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()

    load_started = _threading.Event()
    can_return = _threading.Event()

    def slow_load(_path: str) -> str:
        load_started.set()
        can_return.wait(timeout=2.0)
        return "M"

    backend.load_model.side_effect = slow_load

    results: list[Any] = []

    def call() -> None:
        results.append(job_store.model_cache.load(job, backend))

    t1 = _threading.Thread(target=call)
    t2 = _threading.Thread(target=call)
    t1.start()
    load_started.wait(timeout=1.0)
    t2.start()
    can_return.set()
    t1.join(timeout=2.0)
    t2.join(timeout=2.0)

    assert results == ["M", "M"]
    assert backend.load_model.call_count == 1


def test_model_cache_respects_max_size() -> None:
    """LRU eviction drops the oldest entry past max_size."""
    cache = ModelCache(max_size=2)

    class _FakeJob:
        def __init__(self, path: str, backend: str = "b") -> None:
            self.model_path = path
            self.backend_name = backend
            self.job_id = path

    backend = MagicMock()
    backend.load_model.side_effect = lambda p: f"model-{p}"

    cache.load(_FakeJob("p1"), backend)  # type: ignore[arg-type]
    cache.load(_FakeJob("p2"), backend)  # type: ignore[arg-type]
    cache.load(_FakeJob("p3"), backend)  # type: ignore[arg-type]

    # p1 evicted, p2 + p3 retained.
    assert ("b", "p1") not in cache
    assert ("b", "p2") in cache
    assert ("b", "p3") in cache


# ---------------------------------------------------------------------------
# Dispatch helpers — now take an explicit ``cache`` argument
# ---------------------------------------------------------------------------


def test_get_metrics_table_delegates_to_backend(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "MODEL"
    backend.evaluate_table.return_value = [{"metric": "rmse", "value": 0.1}]

    result = get_metrics_table(job, backend, job_store.model_cache)

    assert result == [{"metric": "rmse", "value": 0.1}]
    backend.evaluate_table.assert_called_once_with("MODEL")


def test_get_split_summary_delegates(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.split_summary.return_value = [{"fold": 0, "score": 0.9}]

    assert get_split_summary(job, backend, job_store.model_cache) == [
        {"fold": 0, "score": 0.9}
    ]


def test_get_importance_passes_kind(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.importance.return_value = {"f1": 0.5}

    result = get_importance(job, backend, job_store.model_cache, kind="gain")

    backend.importance.assert_called_once_with("M", kind="gain")
    assert result == {"f1": 0.5}


def test_get_importance_kinds_delegates(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.importance_kinds.return_value = ["split", "gain"]

    assert get_importance_kinds(job, backend, job_store.model_cache) == [
        "split",
        "gain",
    ]


def test_get_learning_curve_metrics_delegates(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.learning_curve_metrics.return_value = ["rmse", "mae"]

    assert get_learning_curve_metrics(job, backend, job_store.model_cache) == [
        "rmse",
        "mae",
    ]


def test_get_job_plot_delegates(job_store: JobStore, sample_data_ref: DataRef) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    expected = PlotData(plotly_json='{"data": []}')
    backend.plot.return_value = expected

    assert (
        get_job_plot(job, backend, job_store.model_cache, "learning_curve") is expected
    )
    backend.plot.assert_called_once_with("M", "learning_curve")


def test_get_job_plot_tuning_falls_back_to_file(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """When backend.plot('tuning', ...) raises, load saved tuning_plot.json."""
    job = _make_completed_job(job_store, sample_data_ref, job_type="tune")
    plot_path = Path(job.model_path).parent / "tuning_plot.json"
    plot_path.write_text('{"stored": true}', encoding="utf-8")

    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.plot.side_effect = RuntimeError("study missing")

    result = get_job_plot(job, backend, job_store.model_cache, "tuning")

    assert isinstance(result, PlotData)
    assert result.plotly_json == '{"stored": true}'


def test_get_job_plot_tuning_raises_when_no_fallback(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref, job_type="tune")
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.plot.side_effect = RuntimeError("study missing")

    with pytest.raises(RuntimeError, match="study missing"):
        get_job_plot(job, backend, job_store.model_cache, "tuning")


def test_get_available_plots_appends_tuning_when_fallback_exists(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref, job_type="tune")
    plot_path = Path(job.model_path).parent / "tuning_plot.json"
    plot_path.write_text("{}", encoding="utf-8")

    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.available_plots.return_value = ["learning_curve"]

    plots = get_available_plots(job, backend, job_store.model_cache)

    assert "tuning" in plots
    assert "learning_curve" in plots


def test_get_available_plots_does_not_duplicate_tuning(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref, job_type="tune")
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.available_plots.return_value = ["tuning", "learning_curve"]

    plots = get_available_plots(job, backend, job_store.model_cache)

    assert plots.count("tuning") == 1


def test_get_available_plots_fit_job_does_not_add_tuning(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref, job_type="fit")
    plot_path = Path(job.model_path).parent / "tuning_plot.json"
    plot_path.write_text("{}", encoding="utf-8")  # file exists but job_type=fit

    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.available_plots.return_value = ["learning_curve"]

    plots = get_available_plots(job, backend, job_store.model_cache)

    assert "tuning" not in plots


# ---------------------------------------------------------------------------
# Re-export back-compat — jobs.py keeps the dispatch helpers (cache-taking
# variants); the global load_job_model / clear_model_cache* names were
# retired in H-0084.
# ---------------------------------------------------------------------------


def test_jobs_module_reexports_dispatch_helpers() -> None:
    """External imports from services.jobs must continue to work for the
    ``cache``-taking dispatch helpers."""
    from lizystudio.services import jobs as jobs_mod

    for name in (
        "get_metrics_table",
        "get_split_summary",
        "get_importance",
        "get_importance_kinds",
        "get_learning_curve_metrics",
        "get_job_plot",
        "get_available_plots",
    ):
        assert hasattr(jobs_mod, name), f"jobs module missing re-export: {name}"


def test_retired_globals_are_gone() -> None:
    """H-0084: global cache helpers are removed in favour of JobStore
    methods and the ModelCache class."""
    from lizystudio.services import job_results as jr
    from lizystudio.services import jobs as jobs_mod

    assert not hasattr(jr, "load_job_model")
    assert not hasattr(jr, "clear_model_cache")
    assert not hasattr(jr, "clear_model_cache_for")
    assert not hasattr(jr, "_model_cache")

    # services/jobs __all__ must not re-advertise the removed names.
    assert "load_job_model" not in jobs_mod.__all__
    assert "clear_model_cache" not in jobs_mod.__all__
    assert "clear_model_cache_for" not in jobs_mod.__all__
