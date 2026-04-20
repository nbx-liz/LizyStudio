"""Tests for services.job_results — dispatch helpers + model LRU cache.

Covers A-7 split: dispatch-layer helpers that transform a ``Job`` +
``BackendAdapter`` into result data. Persistence-layer tests live in
``test_jobs.py``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef, PlotData
from lizystudio.services.job_results import (
    clear_model_cache,
    get_available_plots,
    get_importance,
    get_importance_kinds,
    get_job_plot,
    get_learning_curve_metrics,
    get_metrics_table,
    get_split_summary,
    load_job_model,
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


@pytest.fixture(autouse=True)
def _reset_model_cache() -> None:
    """Ensure each test starts with a clean cache — avoids cross-test leakage."""
    clear_model_cache()


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
# load_job_model — error path + LRU cache
# ---------------------------------------------------------------------------


def test_load_job_model_raises_when_no_model_path(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """load_job_model must raise ValueError when model_path is None."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    assert job.model_path is None
    backend = MagicMock()

    with pytest.raises(ValueError, match="no saved model"):
        load_job_model(job, backend)


def test_load_job_model_returns_loaded_model(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "MODEL_OBJ"

    model = load_job_model(job, backend)

    assert model == "MODEL_OBJ"
    backend.load_model.assert_called_once_with(job.model_path)


def test_load_job_model_caches_by_path_and_backend(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Second call with same (model_path, backend_name) must hit cache."""
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "MODEL_OBJ"

    first = load_job_model(job, backend)
    second = load_job_model(job, backend)

    assert first is second
    assert backend.load_model.call_count == 1


def test_load_job_model_different_backends_do_not_share_cache(
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

    # Prime both
    assert load_job_model(job_a, backend_a) == "A"
    assert load_job_model(job_b, backend_b) == "B"

    # Repeat — both should be cached
    load_job_model(job_a, backend_a)
    load_job_model(job_b, backend_b)

    assert backend_a.load_model.call_count == 1
    assert backend_b.load_model.call_count == 1


def test_clear_model_cache_forces_reload(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"

    load_job_model(job, backend)
    clear_model_cache()
    load_job_model(job, backend)

    assert backend.load_model.call_count == 2


def test_job_store_delete_invalidates_model_cache(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Deleting a job drops its cached model so a reused path never returns
    a stale, pre-delete deserialized object.
    """
    from lizystudio.services.job_results import _model_cache

    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"

    load_job_model(job, backend)
    key = (job.backend_name, job.model_path)
    assert key in _model_cache

    job_store.delete(job.job_id)

    assert key not in _model_cache


def test_load_job_model_cache_write_is_atomic_under_concurrent_reads(
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
        results.append(load_job_model(job, backend))

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


# ---------------------------------------------------------------------------
# Dispatch helpers
# ---------------------------------------------------------------------------


def test_get_metrics_table_delegates_to_backend(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "MODEL"
    backend.evaluate_table.return_value = [{"metric": "rmse", "value": 0.1}]

    result = get_metrics_table(job, backend)

    assert result == [{"metric": "rmse", "value": 0.1}]
    backend.evaluate_table.assert_called_once_with("MODEL")


def test_get_split_summary_delegates(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.split_summary.return_value = [{"fold": 0, "score": 0.9}]

    assert get_split_summary(job, backend) == [{"fold": 0, "score": 0.9}]


def test_get_importance_passes_kind(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.importance.return_value = {"f1": 0.5}

    result = get_importance(job, backend, kind="gain")

    backend.importance.assert_called_once_with("M", kind="gain")
    assert result == {"f1": 0.5}


def test_get_importance_kinds_delegates(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.importance_kinds.return_value = ["split", "gain"]

    assert get_importance_kinds(job, backend) == ["split", "gain"]


def test_get_learning_curve_metrics_delegates(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.learning_curve_metrics.return_value = ["rmse", "mae"]

    assert get_learning_curve_metrics(job, backend) == ["rmse", "mae"]


def test_get_job_plot_delegates(job_store: JobStore, sample_data_ref: DataRef) -> None:
    job = _make_completed_job(job_store, sample_data_ref)
    backend = MagicMock()
    backend.load_model.return_value = "M"
    expected = PlotData(plotly_json='{"data": []}')
    backend.plot.return_value = expected

    assert get_job_plot(job, backend, "learning_curve") is expected
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

    result = get_job_plot(job, backend, "tuning")

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
        get_job_plot(job, backend, "tuning")


def test_get_available_plots_appends_tuning_when_fallback_exists(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref, job_type="tune")
    plot_path = Path(job.model_path).parent / "tuning_plot.json"
    plot_path.write_text("{}", encoding="utf-8")

    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.available_plots.return_value = ["learning_curve"]

    plots = get_available_plots(job, backend)

    assert "tuning" in plots
    assert "learning_curve" in plots


def test_get_available_plots_does_not_duplicate_tuning(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    job = _make_completed_job(job_store, sample_data_ref, job_type="tune")
    backend = MagicMock()
    backend.load_model.return_value = "M"
    backend.available_plots.return_value = ["tuning", "learning_curve"]

    plots = get_available_plots(job, backend)

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

    plots = get_available_plots(job, backend)

    assert "tuning" not in plots


# ---------------------------------------------------------------------------
# Re-export back-compat — jobs.py must still expose the symbols
# ---------------------------------------------------------------------------


def test_jobs_module_reexports_dispatch_helpers() -> None:
    """External imports from services.jobs must continue to work."""
    from lizystudio.services import jobs as jobs_mod

    for name in (
        "load_job_model",
        "get_metrics_table",
        "get_split_summary",
        "get_importance",
        "get_importance_kinds",
        "get_learning_curve_metrics",
        "get_job_plot",
        "get_available_plots",
    ):
        assert hasattr(jobs_mod, name), f"jobs module missing re-export: {name}"
