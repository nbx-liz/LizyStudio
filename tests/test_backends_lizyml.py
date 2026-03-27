"""Unit tests for the LizyML adapter."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd

from lizystudio.backends.lizyml import LizyMLAdapter
from lizystudio.backends.registry import get_adapter
from lizystudio.backends.types import (
    BackendInfo,
    ConfigSchema,
    PlotData,
    PredictionSummary,
)


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
    # Completion sentinel uses trial count as total
    n_trials = len(mock_model.tune.return_value.trials)
    assert calls[1]["current"] == max(n_trials, 1)
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


# --- export_code ---


def test_export_code_calls_model_export_code() -> None:
    """export_code() delegates to model and returns str path."""
    from pathlib import Path

    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.export_code.return_value = Path("/tmp/exported_code")
    result = adapter.export_code(mock_model, "/tmp/output")
    mock_model.export_code.assert_called_once_with("/tmp/output")
    assert result == "/tmp/exported_code"


def test_export_code_returns_str() -> None:
    """adapter.export_code() must return a str, not a Path object."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.export_code.return_value = Path("/some/path")
    result = adapter.export_code(mock_model, "/some/output")
    assert isinstance(result, str)


# --- get_ui_schema ---


def test_get_ui_schema_returns_dict() -> None:
    """get_ui_schema() must return a non-empty dict."""
    adapter = LizyMLAdapter()
    schema = adapter.get_ui_schema()
    assert isinstance(schema, dict)
    assert len(schema) > 0


# --- get_default_config ---


def test_get_default_config_binary() -> None:
    """get_default_config() returns a validated binary config dict."""
    adapter = LizyMLAdapter()
    config = adapter.get_default_config(task="binary", target="label")
    assert config["task"] == "binary"
    assert config["data"]["target"] == "label"
    assert config["split"]["method"] == "stratified_kfold"


def test_get_default_config_regression() -> None:
    """get_default_config() uses kfold split for regression tasks."""
    adapter = LizyMLAdapter()
    config = adapter.get_default_config(task="regression", target="price")
    assert config["task"] == "regression"
    assert config["split"]["method"] == "kfold"


def test_get_default_config_multiclass() -> None:
    """get_default_config() uses stratified_kfold for multiclass."""
    adapter = LizyMLAdapter()
    config = adapter.get_default_config(task="multiclass", target="class")
    assert config["task"] == "multiclass"
    assert config["split"]["method"] == "stratified_kfold"


# --- validate_config success path ---


def test_validate_config_valid_returns_empty_list() -> None:
    """validate_config() returns empty list when config is valid."""
    adapter = LizyMLAdapter()
    valid_config = adapter.get_default_config(task="binary", target="y")
    errors = adapter.validate_config(valid_config)
    assert errors == []


# --- load_config_from_file edge cases ---


def test_load_config_unknown_extension_fallback_yaml() -> None:
    """Unknown file extension falls back to YAML parser."""
    adapter = LizyMLAdapter()
    content = b"task: binary\nmodel:\n  name: lightgbm"
    result = adapter.load_config_from_file(content, "config.txt")
    assert result["task"] == "binary"


def test_load_config_unknown_extension_fallback_json() -> None:
    """Unknown extension falls back to JSON when YAML fails."""
    adapter = LizyMLAdapter()
    # Pure JSON is also valid YAML in most cases, but this tests the branch
    # where a file with no recognized extension contains JSON.
    content = b'{"task": "regression", "model": {"name": "lgbm"}}'
    result = adapter.load_config_from_file(content, "config.cfg")
    assert result["task"] == "regression"


def test_load_config_unknown_extension_yaml_error_falls_back_to_json() -> None:
    """Unknown extension: when YAML raises YAMLError the parser falls back to JSON."""
    from unittest.mock import patch as _patch

    import yaml

    adapter = LizyMLAdapter()
    content = b'{"task": "binary"}'
    # Force yaml.safe_load to raise so we exercise the except branch
    with _patch("yaml.safe_load", side_effect=yaml.YAMLError("forced")):
        result = adapter.load_config_from_file(content, "data.cfg")
    assert result["task"] == "binary"


def test_load_config_non_mapping_raises() -> None:
    """load_config_from_file raises ValueError when content is not a mapping."""
    import pytest

    adapter = LizyMLAdapter()
    content = b"- item1\n- item2"  # YAML list, not a dict
    with pytest.raises(ValueError, match="Expected a mapping"):
        adapter.load_config_from_file(content, "config.yaml")


# --- create_model ---


def test_create_model_calls_lizyml_model() -> None:
    """create_model() instantiates lizyml.Model with config and dataframe."""
    adapter = LizyMLAdapter()
    mock_model_class = MagicMock()
    mock_df = pd.DataFrame({"x": [1, 2], "y": [0, 1]})
    config = {"task": "binary"}
    with patch("lizystudio.backends.lizyml.LizyMLAdapter.create_model") as mock_create:
        mock_create.return_value = MagicMock()
        result = (
            adapter.create_model.__wrapped__(adapter, config, mock_df)
            if hasattr(adapter.create_model, "__wrapped__")
            else mock_create(config, mock_df)
        )
    # Verify we can at least call into the method without error via a real patch
    with patch("lizyml.Model", return_value=mock_model_class) as mock_model_cls:
        result = adapter.create_model(config, mock_df)
        mock_model_cls.assert_called_once_with(config, data=mock_df)
        assert result is mock_model_class


# --- predict ---


def test_predict_returns_prediction_summary() -> None:
    """predict() returns a PredictionSummary with correct predictions length."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_result = MagicMock()
    mock_result.pred = np.array([1.0, 2.0, 3.0])
    mock_result.proba = None
    mock_result.warnings = ["test warning"]
    mock_model.predict.return_value = mock_result

    result = adapter.predict(mock_model, pd.DataFrame({"x": [1, 2, 3]}))

    assert isinstance(result, PredictionSummary)
    assert len(result.predictions) == 3
    assert result.warnings == ["test warning"]


def test_predict_includes_proba_column_when_present() -> None:
    """predict() adds proba column to predictions DataFrame when proba is not None."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_result = MagicMock()
    mock_result.pred = np.array([0.0, 1.0])
    mock_result.proba = np.array([0.2, 0.8])
    mock_result.warnings = []
    mock_model.predict.return_value = mock_result

    result = adapter.predict(mock_model, pd.DataFrame({"x": [1, 2]}))

    assert "proba" in result.predictions.columns
    assert list(result.predictions["proba"]) == [0.2, 0.8]


def test_predict_passes_return_shap_flag() -> None:
    """predict() forwards return_shap kwarg to model.predict()."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_result = MagicMock()
    mock_result.pred = np.array([1.0])
    mock_result.proba = None
    mock_result.warnings = []
    mock_model.predict.return_value = mock_result

    data = pd.DataFrame({"x": [1]})
    adapter.predict(mock_model, data, return_shap=True)

    # DataFrame equality is ambiguous in assert_called_once_with; check kwargs directly.
    mock_model.predict.assert_called_once()
    _, call_kwargs = mock_model.predict.call_args
    assert call_kwargs.get("return_shap") is True


# --- evaluate_table ---


def test_evaluate_table_returns_records() -> None:
    """evaluate_table() returns a list of dicts from the model's evaluate_table."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.evaluate_table.return_value = pd.DataFrame(
        {"metric": ["auc"], "value": [0.9]}
    )
    result = adapter.evaluate_table(mock_model)
    assert isinstance(result, list)
    assert len(result) == 1


def test_evaluate_table_empty_dataframe() -> None:
    """evaluate_table() returns empty list when model returns empty DataFrame."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.evaluate_table.return_value = pd.DataFrame()
    result = adapter.evaluate_table(mock_model)
    assert result == []


# --- split_summary ---


def test_split_summary_returns_fold_sizes() -> None:
    """split_summary() returns per-fold train/valid sizes."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.fit_result.splits.outer = [
        (np.array([0, 1, 2]), np.array([3, 4])),
        (np.array([3, 4]), np.array([0, 1, 2])),
    ]
    result = adapter.split_summary(mock_model)

    assert len(result) == 2
    assert result[0]["fold"] == 0
    assert result[0]["train_size"] == 3
    assert result[0]["valid_size"] == 2
    assert result[1]["fold"] == 1
    assert result[1]["train_size"] == 2
    assert result[1]["valid_size"] == 3


def test_split_summary_empty_splits() -> None:
    """split_summary() returns empty list when no splits are present."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.fit_result.splits.outer = []
    result = adapter.split_summary(mock_model)
    assert result == []


# --- importance ---


def test_importance_returns_dict() -> None:
    """importance() returns the raw dict from model.importance()."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.importance.return_value = {"f1": 0.7, "f2": 0.3}

    result = adapter.importance(mock_model)

    mock_model.importance.assert_called_once_with(kind="split")
    assert result == {"f1": 0.7, "f2": 0.3}


def test_importance_custom_kind() -> None:
    """importance() forwards kind parameter to model.importance()."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.importance.return_value = {"f1": 100.0}

    adapter.importance(mock_model, kind="gain")

    mock_model.importance.assert_called_once_with(kind="gain")


# --- confusion_matrix ---


def test_confusion_matrix_returns_dict_with_plain_values() -> None:
    """confusion_matrix() returns a plain dict (non-DataFrame values passed through)."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.confusion_matrix.return_value = {
        "accuracy": 0.95,
        "threshold": 0.5,
    }
    result = adapter.confusion_matrix(mock_model)

    mock_model.confusion_matrix.assert_called_once_with(threshold=0.5)
    assert result["accuracy"] == 0.95
    assert result["threshold"] == 0.5


def test_confusion_matrix_converts_dataframe_values() -> None:
    """confusion_matrix() converts DataFrame values to dicts."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    inner_df = pd.DataFrame({"TP": [10], "FP": [2], "FN": [3], "TN": [85]})
    mock_model.confusion_matrix.return_value = {
        "matrix": inner_df,
        "accuracy": 0.95,
    }
    result = adapter.confusion_matrix(mock_model, threshold=0.3)

    mock_model.confusion_matrix.assert_called_once_with(threshold=0.3)
    assert isinstance(result["matrix"], dict)
    assert result["accuracy"] == 0.95


# --- plot ---


def test_plot_known_type_returns_plot_data() -> None:
    """plot() dispatches to correct model method and wraps result in PlotData."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_fig = MagicMock()
    mock_fig.to_json.return_value = '{"data": []}'
    mock_model.plot_learning_curve.return_value = mock_fig

    result = adapter.plot(mock_model, "learning-curve")

    mock_model.plot_learning_curve.assert_called_once()
    assert isinstance(result, PlotData)
    assert result.plotly_json == '{"data": []}'


def test_plot_unknown_type_raises_value_error() -> None:
    """plot() raises ValueError for unrecognised plot type."""
    import pytest

    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    with pytest.raises(ValueError, match="Unknown plot type"):
        adapter.plot(mock_model, "nonexistent-plot")


def test_plot_all_dispatch_keys() -> None:
    """plot() resolves every key in _PLOT_DISPATCH without raising."""
    adapter = LizyMLAdapter()
    for plot_type, method_name in LizyMLAdapter._PLOT_DISPATCH.items():
        mock_model = MagicMock()
        mock_fig = MagicMock()
        mock_fig.to_json.return_value = "{}"
        getattr(mock_model, method_name).return_value = mock_fig
        result = adapter.plot(mock_model, plot_type)
        assert isinstance(result, PlotData)


# --- export_model ---


def test_export_model_calls_model_export() -> None:
    """export_model() delegates to model.export() and returns str path."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.export.return_value = Path("/tmp/exported_model")
    result = adapter.export_model(mock_model, "/tmp/output")
    mock_model.export.assert_called_once_with("/tmp/output")
    assert result == "/tmp/exported_model"
    assert isinstance(result, str)


# --- load_model ---


def test_load_model_calls_lizyml_model_load() -> None:
    """load_model() calls lizyml.Model.load() with the given path."""
    adapter = LizyMLAdapter()
    mock_loaded = MagicMock()
    with patch("lizyml.Model") as mock_model_cls:
        mock_model_cls.load.return_value = mock_loaded
        result = adapter.load_model("/tmp/saved_model")
        mock_model_cls.load.assert_called_once_with("/tmp/saved_model")
        assert result is mock_loaded
