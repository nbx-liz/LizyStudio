"""Unit tests for the LizyML adapter."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

from lizystudio.backends.lizyml import LizyMLAdapter
from lizystudio.backends.registry import get_adapter
from lizystudio.backends.types import BackendInfo, ConfigSchema


def test_adapter_info() -> None:
    adapter = LizyMLAdapter()
    info = adapter.info
    assert isinstance(info, BackendInfo)
    assert info.name == "lizyml"
    assert isinstance(info.version, str)


def test_adapter_config_schema() -> None:
    adapter = LizyMLAdapter()
    schema = adapter.get_config_schema()
    assert isinstance(schema, ConfigSchema)
    assert "properties" in schema.json_schema


def test_adapter_validate_config_empty() -> None:
    adapter = LizyMLAdapter()
    errors = adapter.validate_config({})
    assert len(errors) > 0


def test_adapter_load_config_yaml() -> None:
    adapter = LizyMLAdapter()
    content = b"task: binary\nmodel:\n  name: lightgbm"
    result = adapter.load_config_from_file(content, "config.yaml")
    assert result["task"] == "binary"
    assert result["model"]["name"] == "lightgbm"


def test_adapter_load_config_json() -> None:
    adapter = LizyMLAdapter()
    content = b'{"task": "regression"}'
    result = adapter.load_config_from_file(content, "config.json")
    assert result["task"] == "regression"


def test_registry_get_adapter() -> None:
    adapter = get_adapter("lizyml")
    assert isinstance(adapter, LizyMLAdapter)


def test_registry_unknown_backend() -> None:
    import pytest

    with pytest.raises(ValueError, match="Unknown backend"):
        get_adapter("nonexistent")


# --- available_plots / model_info using public config_normalized path ---


@dataclass
class _FakeRunMeta:
    config_normalized: dict[str, Any]


@dataclass
class _FakeFitResult:
    run_meta: _FakeRunMeta
    feature_names: list[str]


def _make_mock_model(
    task: str = "binary",
    calibration: dict[str, Any] | None = None,
    tuning_result: Any = None,
    model_name: str = "lightgbm",
    target: str = "y",
) -> MagicMock:
    """Build a mock model with fit_result.run_meta.config_normalized."""
    config_normalized: dict[str, Any] = {
        "task": task,
        "model": {"name": model_name},
        "data": {"target": target},
    }
    if calibration is not None:
        config_normalized["calibration"] = calibration

    model = MagicMock()
    model.fit_result = _FakeFitResult(
        run_meta=_FakeRunMeta(config_normalized=config_normalized),
        feature_names=["f1", "f2", "f3"],
    )
    # Configure tuning_plot() to raise when no tuning result
    if tuning_result is not None:
        model.tuning_plot.return_value = MagicMock()
    else:
        model.tuning_plot.side_effect = ValueError("No tuning result")
    return model


def test_available_plots_binary() -> None:
    adapter = LizyMLAdapter()
    model = _make_mock_model(task="binary")
    plots = adapter.available_plots(model)
    assert "learning-curve" in plots
    assert "roc-curve" in plots
    assert "probability-histogram" in plots
    assert "calibration" not in plots
    assert "residuals" not in plots
    assert "tuning" not in plots


def test_available_plots_binary_with_calibration() -> None:
    adapter = LizyMLAdapter()
    model = _make_mock_model(task="binary", calibration={"method": "isotonic"})
    plots = adapter.available_plots(model)
    assert "calibration" in plots


def test_available_plots_regression() -> None:
    adapter = LizyMLAdapter()
    model = _make_mock_model(task="regression")
    plots = adapter.available_plots(model)
    assert "residuals" in plots
    assert "roc-curve" not in plots


def test_available_plots_with_tuning() -> None:
    adapter = LizyMLAdapter()
    model = _make_mock_model(task="binary", tuning_result={"some": "data"})
    plots = adapter.available_plots(model)
    assert "tuning" in plots


def test_fit_invokes_on_progress() -> None:
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.fit.return_value = MagicMock(
        metrics={"raw": {"oof": {"auc": 0.9}}},
        splits=MagicMock(outer=[([], [])]),
    )
    mock_model.params_table.return_value = MagicMock(
        reset_index=MagicMock(
            return_value=MagicMock(to_dict=MagicMock(return_value=[]))
        )
    )
    calls: list[dict] = []

    def progress_cb(*, current: int, total: int, message: str) -> None:
        calls.append({"current": current, "total": total, "message": message})

    adapter.fit(mock_model, on_progress=progress_cb)
    assert len(calls) == 2
    assert calls[0]["current"] == 0
    assert calls[1]["current"] == 1


def test_tune_invokes_on_progress() -> None:
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = MagicMock(
        best_params={"lr": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
    )
    calls: list[dict] = []

    def progress_cb(*, current: int, total: int, message: str) -> None:
        calls.append({"current": current, "total": total, "message": message})

    adapter.tune(mock_model, on_progress=progress_cb)
    # Must pass progress_callback kwarg to model.tune()
    mock_model.tune.assert_called_once()
    _, kwargs = mock_model.tune.call_args
    assert "progress_callback" in kwargs
    assert callable(kwargs["progress_callback"])
    # Start + complete = 2 calls minimum (no trial callbacks fired by mock)
    assert len(calls) == 2
    assert calls[0]["current"] == 0
    assert calls[0]["message"] == "Starting tuning..."
    assert calls[1]["current"] == 1
    assert calls[1]["message"] == "Tuning complete."


def test_tune_bridge_callback_maps_fields() -> None:
    """Verify the bridge callback correctly maps TuneProgressInfo fields."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    calls: list[dict] = []

    def progress_cb(*, current: int, total: int, message: str) -> None:
        calls.append({"current": current, "total": total, "message": message})

    # We need to capture the bridge callback and invoke it manually
    def fake_tune(*, progress_callback: Any = None) -> MagicMock:
        if progress_callback is not None:
            # Simulate TuneProgressInfo with a simple namespace
            info = MagicMock()
            info.current_trial = 3
            info.total_trials = 10
            info.best_score = 0.9123
            info.latest_score = 0.8765
            info.latest_state = "COMPLETE"
            progress_callback(info)

            # Test with None scores
            info2 = MagicMock()
            info2.current_trial = 1
            info2.total_trials = 10
            info2.best_score = None
            info2.latest_score = None
            info2.latest_state = "PRUNED"
            progress_callback(info2)

        return MagicMock(
            best_params={"lr": 0.1},
            best_score=0.9,
            trials=[],
            metric_name="auc",
            direction="maximize",
        )

    mock_model.tune = fake_tune

    adapter.tune(mock_model, on_progress=progress_cb)

    # calls: start, trial3, trial1(none scores), complete = 4
    assert len(calls) == 4
    assert calls[0]["message"] == "Starting tuning..."

    # Trial with scores
    assert calls[1]["current"] == 3
    assert calls[1]["total"] == 10
    assert "Trial 3/10" in calls[1]["message"]
    assert "Best: 0.9123" in calls[1]["message"]
    assert "Latest: 0.8765 (COMPLETE)" in calls[1]["message"]

    # Trial with None scores
    assert calls[2]["current"] == 1
    assert calls[2]["total"] == 10
    assert "Best:" not in calls[2]["message"]
    assert "Latest:" not in calls[2]["message"]

    assert calls[3]["message"] == "Tuning complete."


def test_tune_no_progress_callback_skips_bridge() -> None:
    """When on_progress is None, tune() skips progress_callback."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = MagicMock(
        best_params={"lr": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
    )

    adapter.tune(mock_model)
    mock_model.tune.assert_called_once_with(progress_callback=None)


def test_model_info_returns_target() -> None:
    adapter = LizyMLAdapter()
    model = _make_mock_model(task="binary", target="price")
    info = adapter.model_info(model)
    assert info["task"] == "binary"
    assert info["model_name"] == "lightgbm"
    assert info["target"] == "price"
    assert info["feature_count"] == 3
