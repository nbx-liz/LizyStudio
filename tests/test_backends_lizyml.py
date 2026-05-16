"""Unit tests for the LizyML adapter."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from lizystudio.backends.lizyml import LizyMLAdapter
from lizystudio.backends.registry import get_adapter
from lizystudio.backends.types import (
    BackendInfo,
    ConfigSchema,
    IncompatibleMetric,
    PlotData,
    PredictionSummary,
)

pytestmark = pytest.mark.unit


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


# H-0062 Bugfix 2026-04-14 (3): backend-side guard against the class of
# inconsistent configs that surfaced when a user briefly selected a
# different task and the frontend did not reset model.params.objective /
# metric when switching back. A Tune job with task=binary and
# objective=multiclass made LGBM fail every trial with
# "All tuning trials failed. Check parameter ranges." — the error was
# correct in substance but pointed at parameter ranges instead of the
# real culprit. The validator now rejects the mismatch up-front.


def _valid_binary_config(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "config_version": 1,
        "task": "binary",
        "data": {"target": "y"},
        "model": {"name": "lgbm", "params": {}},
        "split": {"method": "stratified_kfold"},
    }
    for key, value in overrides.items():
        base[key] = value
    return base


def test_adapter_validate_config_rejects_binary_with_multiclass_objective() -> None:
    adapter = LizyMLAdapter()
    cfg = _valid_binary_config()
    cfg["model"]["params"] = {"objective": "multiclass"}
    errors = adapter.validate_config(cfg)
    assert any(
        "objective" in str(e.get("loc", ())) or "objective" in str(e.get("msg", ""))
        for e in errors
    ), errors


def test_adapter_validate_config_rejects_binary_with_multiclass_metric() -> None:
    adapter = LizyMLAdapter()
    cfg = _valid_binary_config()
    cfg["model"]["params"] = {"metric": ["auc_mu", "multi_logloss"]}
    errors = adapter.validate_config(cfg)
    assert any(
        "metric" in str(e.get("loc", ())) or "metric" in str(e.get("msg", ""))
        for e in errors
    ), errors


def test_adapter_validate_config_accepts_binary_with_binary_params() -> None:
    adapter = LizyMLAdapter()
    cfg = _valid_binary_config()
    cfg["model"]["params"] = {
        "objective": "binary",
        "metric": ["auc", "binary_logloss"],
    }
    errors = adapter.validate_config(cfg)
    # No task/objective compat error (there may still be unrelated schema
    # errors depending on lizyml's Pydantic schema — just ensure our
    # specific checks do not flag this valid config).
    compat_errors = [
        e
        for e in errors
        if (
            "task_objective_mismatch" in str(e.get("type", ""))
            or "task_metric_mismatch" in str(e.get("type", ""))
        )
    ]
    assert compat_errors == []


def test_adapter_validate_config_rejects_regression_with_binary_objective() -> None:
    adapter = LizyMLAdapter()
    cfg: dict[str, Any] = {
        "config_version": 1,
        "task": "regression",
        "data": {"target": "y"},
        "model": {"name": "lgbm", "params": {"objective": "binary"}},
        "split": {"method": "kfold"},
    }
    errors = adapter.validate_config(cfg)
    assert any(
        "objective" in str(e.get("loc", ())) or "objective" in str(e.get("msg", ""))
        for e in errors
    ), errors


def test_adapter_validate_config_rejects_partial_metric_mismatch() -> None:
    """H-0062 Bugfix 2026-04-14 (7): flag any invalid metric, not just
    the all-invalid case. LightGBM rejects ``metric=["auc","multi_logloss"]``
    because multi_logloss is incompatible with task=binary, and the old
    "only flag when every metric is invalid" policy let it through."""
    adapter = LizyMLAdapter()
    cfg = _valid_binary_config()
    cfg["model"]["params"] = {"metric": ["auc", "multi_logloss"]}
    errors = adapter.validate_config(cfg)
    assert any(
        "metric" in str(e.get("loc", ())) or "metric" in str(e.get("msg", ""))
        for e in errors
    ), errors


def test_adapter_validate_config_accepts_empty_metric_list() -> None:
    """An empty metric list must NOT be flagged — the adapter already
    supplies defaults downstream. Flagging an empty list would break
    the common case of 'leave the field unset and let the backend
    decide'."""
    adapter = LizyMLAdapter()
    cfg = _valid_binary_config()
    cfg["model"]["params"] = {"metric": []}
    errors = adapter.validate_config(cfg)
    compat = [
        e
        for e in errors
        if str(e.get("type", "")).startswith(
            ("task_objective_mismatch", "task_metric_mismatch")
        )
    ]
    assert compat == []


def test_adapter_validate_config_does_not_crash_on_non_dict_model() -> None:
    """H-0062 Bugfix 2026-04-14 (7): pydantic may reject a non-dict
    ``model`` field with its own error, but the compat helper used to
    blindly call ``.get("params")`` on whatever was there. If pydantic
    had already captured the type error and the helper ran next on a
    list / string, it crashed with AttributeError and the caller saw a
    500 instead of a structured error list. The helper must short
    circuit when ``model`` is not a dict."""
    adapter = LizyMLAdapter()
    cfg: dict[str, Any] = {
        "config_version": 1,
        "task": "binary",
        "data": {"target": "y"},
        # model is a list instead of a dict — pydantic will reject it.
        "model": ["invalid"],
        "split": {"method": "stratified_kfold"},
    }
    # Must not raise.
    errors = adapter.validate_config(cfg)
    assert isinstance(errors, list)


def test_adapter_validate_config_does_not_crash_on_non_dict_params() -> None:
    """Defensive: params field is a list (malformed) — helper must not
    crash."""
    adapter = LizyMLAdapter()
    cfg: dict[str, Any] = {
        "config_version": 1,
        "task": "binary",
        "data": {"target": "y"},
        "model": {"name": "lgbm", "params": ["invalid"]},
        "split": {"method": "stratified_kfold"},
    }
    errors = adapter.validate_config(cfg)
    assert isinstance(errors, list)


def test_adapter_validate_config_rejects_regression_with_calibration() -> None:
    """Issue #269: lizyml only supports calibration for task='binary'
    and raises ``CALIBRATION_NOT_SUPPORTED`` ~5s after Fit otherwise.
    The compat helper must surface that mismatch up-front so the
    'Fix validation errors first' banner blocks the run.
    """
    adapter = LizyMLAdapter()
    cfg: dict[str, Any] = {
        "config_version": 1,
        "task": "regression",
        "data": {"target": "y"},
        "model": {"name": "lgbm", "params": {"objective": "huber"}},
        "split": {"method": "kfold"},
        "calibration": {"method": "platt", "n_splits": 5, "params": {}},
    }
    errors = adapter.validate_config(cfg)
    assert any(
        e.get("type") == "task_calibration_mismatch"
        or "calibration" in str(e.get("loc", ()))
        for e in errors
    ), errors


def test_adapter_validate_config_rejects_multiclass_with_calibration() -> None:
    """Same guard for multiclass — calibration is binary-only."""
    adapter = LizyMLAdapter()
    cfg: dict[str, Any] = {
        "config_version": 1,
        "task": "multiclass",
        "data": {"target": "y"},
        "model": {"name": "lgbm", "params": {"objective": "multiclass"}},
        "split": {"method": "stratified_kfold"},
        "calibration": {"method": "platt", "n_splits": 5, "params": {}},
    }
    errors = adapter.validate_config(cfg)
    assert any(e.get("type") == "task_calibration_mismatch" for e in errors), errors


def test_adapter_validate_config_accepts_binary_with_calibration() -> None:
    """Sanity check: calibration with task='binary' must NOT trigger the
    new compat error."""
    adapter = LizyMLAdapter()
    cfg = _valid_binary_config()
    cfg["calibration"] = {"method": "platt", "n_splits": 5, "params": {}}
    errors = adapter.validate_config(cfg)
    compat = [e for e in errors if e.get("type") == "task_calibration_mismatch"]
    assert compat == []


def test_adapter_validate_config_accepts_null_calibration_for_any_task() -> None:
    """``calibration: null`` is the explicit 'off' state — must never
    trigger the calibration compat error regardless of task."""
    adapter = LizyMLAdapter()
    for task in ("binary", "multiclass", "regression"):
        cfg: dict[str, Any] = {
            "config_version": 1,
            "task": task,
            "data": {"target": "y"},
            "model": {"name": "lgbm"},
            "split": {
                "method": "stratified_kfold" if task != "regression" else "kfold"
            },
            "calibration": None,
        }
        errors = adapter.validate_config(cfg)
        compat = [e for e in errors if e.get("type") == "task_calibration_mismatch"]
        assert compat == [], (task, errors)


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
    assert "probability-histogram" not in plots  # requires calibration
    assert "calibration" not in plots
    assert "residuals" not in plots
    assert "tuning" not in plots


def test_available_plots_binary_with_calibration() -> None:
    adapter = LizyMLAdapter()
    model = _make_mock_model(task="binary", calibration={"method": "isotonic"})
    plots = adapter.available_plots(model)
    assert "calibration" in plots
    assert "probability-histogram" in plots


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


# --- Issue #373: shap-summary plot wiring ---


def test_available_plots_includes_shap_summary_when_supported() -> None:
    """available_plots() advertises 'shap-summary' when the model can
    compute fold-averaged SHAP importances (Issue #373).

    Mirrors the existing tuning probe pattern: we call
    ``model.importance(kind='shap')`` defensively and skip when it
    raises (shap missing, no analysis_context, etc).
    """
    adapter = LizyMLAdapter()
    model = _make_mock_model(task="binary")
    # Defensive: importance(kind='shap') succeeds → shap is available
    model.importance.return_value = {"f1": 0.3, "f2": 0.5, "f3": 0.2}
    plots = adapter.available_plots(model)
    assert "shap-summary" in plots


def test_available_plots_omits_shap_summary_when_not_supported() -> None:
    """available_plots() omits 'shap-summary' when the SHAP probe raises.

    Replicates the OPTIONAL_DEP_MISSING / MODEL_NOT_FIT cases lizyml
    raises from importance(kind='shap') when shap is missing or the
    fit lacks analysis_context.
    """
    adapter = LizyMLAdapter()
    model = _make_mock_model(task="binary")
    model.importance.side_effect = RuntimeError("OPTIONAL_DEP_MISSING")
    plots = adapter.available_plots(model)
    assert "shap-summary" not in plots


def test_plot_shap_summary_dispatches_to_importance_plot_with_kind_shap() -> None:
    """plot('shap-summary') resolves to importance_plot(kind='shap').

    Reuses lizyml's existing ``importance_plot(kind='shap', top_n=20)``
    method (Model.importance_plot supports kind=split/gain/shap). No
    new lizyml method is required.
    """
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_fig = MagicMock()
    mock_fig.to_json.return_value = "{}"
    mock_model.importance_plot.return_value = mock_fig

    result = adapter.plot(mock_model, "shap-summary")

    mock_model.importance_plot.assert_called_once_with(kind="shap")
    assert isinstance(result, PlotData)


def test_plot_dispatch_table_includes_shap_summary() -> None:
    """``shap-summary`` must be a registered key in _PLOT_DISPATCH so
    PlotNotAvailableError lists it under ``available`` (Issue #373).
    """
    assert "shap-summary" in LizyMLAdapter._PLOT_DISPATCH


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

    def progress_cb(*, current: int, total: int, message: str, **extra: Any) -> None:
        calls.append({"current": current, "total": total, "message": message, **extra})

    adapter.fit(mock_model, on_progress=progress_cb)
    assert len(calls) == 2
    # Fit sends indeterminate progress (total=0) because lizyml
    # does not provide intermediate progress callbacks.
    assert calls[0] == {"current": 0, "total": 0, "message": "Fitting model..."}
    assert calls[1] == {"current": 1, "total": 1, "message": "Fit complete."}


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

    def progress_cb(*, current: int, total: int, message: str, **extra: Any) -> None:
        calls.append({"current": current, "total": total, "message": message, **extra})

    adapter.tune(mock_model, on_progress=progress_cb)
    # Must pass progress_callback kwarg to model.tune()
    mock_model.tune.assert_called_once()
    _, kwargs = mock_model.tune.call_args
    assert "progress_callback" in kwargs
    assert callable(kwargs["progress_callback"])
    # Start + complete = 2 calls minimum (no trial callbacks fired by mock)
    assert len(calls) == 2
    # Tune initial message uses indeterminate (total=0) until
    # first trial callback provides the real total.
    assert calls[0] == {
        "current": 0,
        "total": 0,
        "message": "Starting tuning...",
    }
    # Completion sentinel uses trial count as total
    n_trials = len(mock_model.tune.return_value.trials)
    assert calls[1]["current"] == max(n_trials, 1)
    assert calls[1]["message"] == "Tuning complete."


def test_tune_bridge_callback_maps_fields() -> None:
    """Verify the bridge callback correctly maps TuneProgressInfo fields."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    calls: list[dict] = []

    def progress_cb(*, current: int, total: int, message: str, **extra: Any) -> None:
        calls.append({"current": current, "total": total, "message": message, **extra})

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


# --- re-tune (H-0061) ---


def _fake_lizyml_tuning_result(
    best_score: float = 0.9,
    rounds: Any = None,
    boundary_report: Any = None,
    trials: list[Any] | None = None,
) -> MagicMock:
    """Build a MagicMock that mimics a lizyml TuningResult."""
    result = MagicMock()
    result.best_params = {"lr": 0.1}
    result.best_score = best_score
    result.trials = trials if trials is not None else []
    result.metric_name = "auc"
    result.direction = "maximize"
    result.rounds = rounds
    result.boundary_report = boundary_report
    return result


def _make_round(
    round_no: int,
    *,
    n_trials: int = 10,
    best_before: float | None = None,
    best_after: float = 0.85,
    expanded: tuple[str, ...] = (),
    space: tuple[Any, ...] = (),
) -> MagicMock:
    r = MagicMock()
    r.round = round_no
    r.n_trials = n_trials
    r.best_score_before = best_before
    r.best_score_after = best_after
    r.expanded_dims = expanded
    r.space_snapshot = space
    return r


def test_tune_re_tune_runs_multi_round_loop() -> None:
    """re_tune.n_rounds=3 triggers three calls to model.tune()."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    adapter.tune(mock_model, re_tune={"n_rounds": 3})

    assert mock_model.tune.call_count == 3
    # Round 1 — no resume
    first_kwargs = mock_model.tune.call_args_list[0].kwargs
    assert "resume" not in first_kwargs
    # Rounds 2 and 3 — resume=True
    for call in mock_model.tune.call_args_list[1:]:
        assert call.kwargs["resume"] is True


def test_tune_re_tune_forwards_expand_and_threshold_kwargs() -> None:
    """expand_boundary / boundary_threshold are passed to rounds 2..N only."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    adapter.tune(
        mock_model,
        re_tune={
            "n_rounds": 2,
            "expand_boundary": True,
            "boundary_threshold": 0.1,
            "n_trials": 20,
        },
    )

    first = mock_model.tune.call_args_list[0].kwargs
    second = mock_model.tune.call_args_list[1].kwargs
    # First round does not receive resume kwargs
    assert "resume" not in first
    assert "expand_boundary" not in first
    # Second round receives resume + expand kwargs
    assert second["resume"] is True
    assert second["expand_boundary"] is True
    assert second["boundary_threshold"] == 0.1
    assert second["n_trials"] == 20


def test_tune_re_tune_n_rounds_1_matches_legacy_call() -> None:
    """re_tune.n_rounds=1 is equivalent to legacy tune (single call)."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    adapter.tune(mock_model, re_tune={"n_rounds": 1})
    mock_model.tune.assert_called_once()
    assert "resume" not in mock_model.tune.call_args.kwargs


@pytest.mark.parametrize("bad", [0, -1, "abc", 1.5, True, False])
def test_tune_re_tune_invalid_n_rounds_raises(bad: Any) -> None:
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()
    with pytest.raises(ValueError, match="n_rounds"):
        adapter.tune(mock_model, re_tune={"n_rounds": bad})


@pytest.mark.parametrize("bad", [0, -1, "abc", 1.5, True, False])
def test_tune_re_tune_invalid_n_trials_raises(bad: Any) -> None:
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()
    with pytest.raises(ValueError, match="n_trials"):
        adapter.tune(mock_model, re_tune={"n_rounds": 2, "n_trials": bad})


def test_tune_re_tune_invalid_threshold_raises() -> None:
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()
    with pytest.raises(ValueError, match="boundary_threshold"):
        adapter.tune(
            mock_model,
            re_tune={"n_rounds": 2, "boundary_threshold": 0.9},
        )


def test_tune_serializes_rounds_and_boundary_report() -> None:
    """When lizyml returns rounds/boundary_report, they appear in the summary."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    r1 = _make_round(1, n_trials=30, best_before=None, best_after=0.85, expanded=())
    r2 = _make_round(
        2, n_trials=20, best_before=0.85, best_after=0.87, expanded=("lr",)
    )
    dim = MagicMock(
        name="lr",
        best_value=0.03,
        low=0.001,
        high=0.1,
        position_pct=0.25,
        edge="none",
        expanded=False,
        new_low=None,
        new_high=None,
    )
    # Override the automatic .name attribute from MagicMock(name=...)
    dim.name = "lr"
    report = MagicMock()
    report.dims = (dim,)
    report.expanded_names = ("lr",)

    trial = MagicMock()
    trial.number = 0
    trial.params = {"lr": 0.03}
    trial.score = 0.87
    trial.state = "complete"
    trial.round = 2

    mock_model.tune.return_value = _fake_lizyml_tuning_result(
        best_score=0.87,
        rounds=(r1, r2),
        boundary_report=report,
        trials=[trial],
    )

    summary = adapter.tune(mock_model, re_tune={"n_rounds": 2})

    assert summary.rounds is not None
    assert len(summary.rounds) == 2
    assert summary.rounds[0]["round"] == 1
    assert summary.rounds[0]["best_score_before"] is None
    assert summary.rounds[1]["expanded_dims"] == ["lr"]

    assert summary.boundary_report is not None
    assert summary.boundary_report["expanded_names"] == ["lr"]
    assert len(summary.boundary_report["dims"]) == 1
    assert summary.boundary_report["dims"][0]["name"] == "lr"

    assert summary.trials[0]["round"] == 2


def test_tune_legacy_single_round_leaves_rounds_none() -> None:
    """Legacy single-round tune leaves rounds/boundary_report as None."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result(
        rounds=None,
        boundary_report=None,
    )

    summary = adapter.tune(mock_model)
    assert summary.rounds is None
    assert summary.boundary_report is None


def test_tune_pruned_trial_with_none_score_does_not_crash() -> None:
    """Optuna PRUNED/FAIL trials carry score=None; serialization must preserve it."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    pruned = MagicMock()
    pruned.number = 0
    pruned.params = {"lr": 0.01}
    pruned.score = None
    pruned.state = "pruned"
    pruned.round = 1

    mock_model.tune.return_value = _fake_lizyml_tuning_result(trials=[pruned])

    summary = adapter.tune(mock_model)
    assert summary.trials[0]["score"] is None
    assert summary.trials[0]["state"] == "pruned"


def test_tune_re_tune_empty_dict_is_valid() -> None:
    """An empty re_tune={} should behave like re_tune=None (single round)."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    adapter.tune(mock_model, re_tune={})
    mock_model.tune.assert_called_once()
    assert "resume" not in mock_model.tune.call_args.kwargs


def test_tune_re_tune_expand_boundary_false_forwarded() -> None:
    """expand_boundary=False must be forwarded, not coerced or dropped."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    adapter.tune(
        mock_model,
        re_tune={"n_rounds": 2, "expand_boundary": False},
    )
    second = mock_model.tune.call_args_list[1].kwargs
    assert second["resume"] is True
    assert second["expand_boundary"] is False


def test_tune_re_tune_threshold_zero_rejected() -> None:
    """boundary_threshold=0.0 hits lizyml's strict lower bound and must raise.

    lizyml 0.9.0 Model.tune enforces ``0.0 < threshold < 0.5`` — surfacing
    the error here (before calling the model) gives a clean ValueError
    instead of a LizyMLError burying the root cause.
    """
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    with pytest.raises(ValueError, match="boundary_threshold"):
        adapter.tune(
            mock_model,
            re_tune={"n_rounds": 2, "boundary_threshold": 0.0},
        )


def test_tune_re_tune_threshold_upper_bound_exclusive() -> None:
    """boundary_threshold=0.499 is just under the exclusive upper bound."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    adapter.tune(
        mock_model,
        re_tune={"n_rounds": 2, "boundary_threshold": 0.499},
    )
    second = mock_model.tune.call_args_list[1].kwargs
    assert second["boundary_threshold"] == 0.499


def test_tune_re_tune_threshold_smallest_positive_accepted() -> None:
    """A tiny positive threshold (e.g. 0.001) is within the open range."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    adapter.tune(
        mock_model,
        re_tune={"n_rounds": 2, "boundary_threshold": 0.001},
    )
    second = mock_model.tune.call_args_list[1].kwargs
    assert second["boundary_threshold"] == 0.001


def test_tune_re_tune_threshold_negative_rejected() -> None:
    """Negative thresholds hit the lower bound and must raise."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    with pytest.raises(ValueError, match="boundary_threshold"):
        adapter.tune(
            mock_model,
            re_tune={"n_rounds": 2, "boundary_threshold": -0.01},
        )


def test_tune_re_tune_threshold_string_rejected() -> None:
    """Strings must not be silently coerced to float via _parse_re_tune."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    with pytest.raises(ValueError, match="boundary_threshold"):
        adapter.tune(
            mock_model,
            re_tune={"n_rounds": 2, "boundary_threshold": "0.1"},
        )


def test_tune_re_tune_threshold_exact_0_5_rejected() -> None:
    """boundary_threshold=0.5 hits the exclusive upper bound and must raise."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    with pytest.raises(ValueError, match="boundary_threshold"):
        adapter.tune(
            mock_model,
            re_tune={"n_rounds": 2, "boundary_threshold": 0.5},
        )


def test_tune_re_tune_n_rounds_upper_bound_rejected() -> None:
    """n_rounds > _MAX_RE_TUNE_ROUNDS must raise (DoS guard)."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    with pytest.raises(ValueError, match="n_rounds"):
        adapter.tune(mock_model, re_tune={"n_rounds": 1000000})


def test_tune_re_tune_n_trials_upper_bound_rejected() -> None:
    """n_trials > _MAX_RE_TUNE_TRIALS_PER_ROUND must raise (DoS guard)."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    with pytest.raises(ValueError, match="n_trials"):
        adapter.tune(mock_model, re_tune={"n_rounds": 2, "n_trials": 1_000_000})


def test_tune_re_tune_nones_use_defaults() -> None:
    """Explicit None values in re_tune fall back to lizyml defaults."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    adapter.tune(
        mock_model,
        re_tune={
            "n_rounds": 2,
            "n_trials": None,
            "expand_boundary": None,
            "boundary_threshold": None,
        },
    )
    second = mock_model.tune.call_args_list[1].kwargs
    assert second["resume"] is True
    # None-valued keys should not be forwarded
    assert "n_trials" not in second
    assert "expand_boundary" not in second
    assert "boundary_threshold" not in second


def test_tune_serializes_search_dim_from_round_snapshot() -> None:
    """Round.space_snapshot entries are serialized via _serialize_search_dim.

    Uses the real lizyml SearchDim dataclasses so that class-name-based
    type detection is exercised end-to-end.
    """
    from lizyml.core.types.search_dim import (
        CategoricalDim,
        FloatDim,
        IntDim,
    )

    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    dim_float = FloatDim(name="lr", low=1e-4, high=1e-1, log=True, category="model")
    dim_int = IntDim(name="num_leaves", low=16, high=256, log=False, category="model")
    dim_cat = CategoricalDim(name="optim", choices=("adam", "sgd"), category="training")

    r1 = _make_round(
        1,
        n_trials=10,
        best_after=0.9,
        expanded=(),
        space=(dim_float, dim_int, dim_cat),
    )

    mock_model.tune.return_value = _fake_lizyml_tuning_result(rounds=(r1,))

    summary = adapter.tune(mock_model, re_tune={"n_rounds": 1})

    assert summary.rounds is not None
    snapshot = summary.rounds[0]["space_snapshot"]
    assert len(snapshot) == 3

    float_dim = snapshot[0]
    assert float_dim["name"] == "lr"
    assert float_dim["type"] == "float"
    assert float_dim["category"] == "model"
    assert float_dim["low"] == 1e-4
    assert float_dim["high"] == 1e-1
    assert float_dim["log"] is True
    assert "choices" not in float_dim  # FloatDim has no choices field

    int_dim = snapshot[1]
    assert int_dim["name"] == "num_leaves"
    assert int_dim["type"] == "int"
    assert int_dim["category"] == "model"
    assert int_dim["low"] == 16
    assert int_dim["high"] == 256
    assert int_dim["log"] is False

    cat = snapshot[2]
    assert cat["name"] == "optim"
    assert cat["type"] == "categorical"
    assert cat["category"] == "training"
    assert cat["choices"] == ["adam", "sgd"]  # tuple -> list
    assert "low" not in cat
    assert "high" not in cat


def test_tune_serialize_empty_trials_yields_empty_list() -> None:
    """Empty trial list is preserved as an empty list, not None."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result(trials=[])

    summary = adapter.tune(mock_model)
    assert summary.trials == []


def test_tune_best_score_zero_float_preserved() -> None:
    """best_score=0.0 must be preserved and not treated as missing."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result(best_score=0.0)

    summary = adapter.tune(mock_model)
    assert summary.best_score == 0.0


def test_tune_re_tune_invalid_n_rounds_error_message_includes_value() -> None:
    """ValueError carries the offending value for debugging."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _fake_lizyml_tuning_result()

    with pytest.raises(ValueError, match="1.5"):
        adapter.tune(mock_model, re_tune={"n_rounds": 1.5})


def test_tune_boundary_report_edge_none_preserved_as_none() -> None:
    """Edge value None is preserved, not coerced to the literal string 'None'."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    dim = MagicMock()
    dim.name = "param_a"
    dim.best_value = 0.5
    dim.low = 0.0
    dim.high = 1.0
    dim.position_pct = 0.5
    dim.edge = None
    dim.expanded = False
    dim.new_low = None
    dim.new_high = None

    report = MagicMock()
    report.dims = (dim,)
    report.expanded_names = ()

    mock_model.tune.return_value = _fake_lizyml_tuning_result(
        boundary_report=report,
    )

    summary = adapter.tune(mock_model)
    assert summary.boundary_report is not None
    assert summary.boundary_report["dims"][0]["edge"] is None


def test_tune_re_tune_progress_emits_round_field() -> None:
    """Progress callbacks from multi-round tune carry round metadata."""
    adapter = LizyMLAdapter()

    trial_calls: list[dict[str, Any]] = []

    def _progress(*, current: int, total: int, message: str, **extra: Any) -> None:
        trial_calls.append({"current": current, "total": total, **extra})

    # Fake model.tune emits progress_callback invocations
    def fake_tune(*, progress_callback: Any = None, **_: Any) -> Any:
        if progress_callback is not None:
            info = MagicMock()
            info.current_trial = 1
            info.total_trials = 5
            info.best_score = 0.8
            info.latest_score = 0.8
            info.latest_state = "complete"
            progress_callback(info)
        return _fake_lizyml_tuning_result()

    mock_model = MagicMock()
    mock_model.tune = fake_tune

    adapter.tune(
        mock_model,
        on_progress=_progress,
        re_tune={"n_rounds": 2},
    )

    # At least one trial callback from each round should carry round=1/2
    round_values = {c.get("round") for c in trial_calls if "round" in c}
    assert 1 in round_values
    assert 2 in round_values


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


def test_get_default_config_training_seed_overrides_library_default() -> None:
    """get_default_config() injects training.seed=1120 across all tasks.

    P-0104 Wave 2.2 / Issue #459: the library default ``TrainingConfig.seed=42``
    is overridden at the Studio default-config layer so fresh Fit-tab configs
    match the Tune-tab catalog seed default already at 1120. This keeps the
    Fit / Tune split reproducible without manual override.
    """
    adapter = LizyMLAdapter()
    for task, target in (
        ("binary", "label"),
        ("regression", "price"),
        ("multiclass", "class"),
    ):
        config = adapter.get_default_config(task=task, target=target)
        assert config["training"]["seed"] == 1120, (
            f"task={task} default seed must be 1120 (Wave 2.2), got "
            f"{config['training']['seed']}"
        )


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


# --- importance_kinds ---


def test_importance_kinds_returns_list() -> None:
    """importance_kinds() returns the list of valid importance kinds."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    result = adapter.importance_kinds(mock_model)

    assert isinstance(result, list)
    assert "split" in result
    assert "gain" in result
    assert "shap" in result


# --- learning_curve_metrics ---


def _model_with_history(history: list[Any]) -> MagicMock:
    mock_model = MagicMock()
    mock_model.fit_result.history = history
    return mock_model


def test_learning_curve_metrics_collects_from_eval_history() -> None:
    """learning_curve_metrics() returns metric names from fit_result.history."""
    adapter = LizyMLAdapter()
    history = [
        {
            "eval_history": {
                "valid_0": {"f1": [0.1, 0.2, 0.3]},
            }
        },
        {
            "eval_history": {
                "valid_0": {"f1": [0.2, 0.3], "auc": [0.7, 0.8]},
            }
        },
    ]
    model = _model_with_history(history)

    result = adapter.learning_curve_metrics(model)

    assert result == ["f1", "auc"]


def test_learning_curve_metrics_deduplicates_across_datasets() -> None:
    """Names appearing under multiple datasets are deduplicated."""
    adapter = LizyMLAdapter()
    history = [
        {
            "eval_history": {
                "valid_0": {"binary_logloss": [0.5]},
                "valid_1": {"binary_logloss": [0.6], "auc": [0.9]},
            }
        },
    ]
    model = _model_with_history(history)

    result = adapter.learning_curve_metrics(model)

    assert sorted(result) == ["auc", "binary_logloss"]


def test_learning_curve_metrics_empty_when_no_history() -> None:
    """Returns empty list when history is missing or empty."""
    adapter = LizyMLAdapter()
    assert adapter.learning_curve_metrics(_model_with_history([])) == []

    mock_model = MagicMock()
    mock_model.fit_result = None
    assert adapter.learning_curve_metrics(mock_model) == []


def test_learning_curve_metrics_skips_folds_without_eval_history() -> None:
    """Folds with missing/empty eval_history are skipped gracefully."""
    adapter = LizyMLAdapter()
    history = [
        {},
        {"eval_history": {}},
        {"eval_history": {"valid_0": {"f1": [0.1]}}},
    ]
    model = _model_with_history(history)

    result = adapter.learning_curve_metrics(model)

    assert result == ["f1"]


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


def test_plot_unknown_type_raises_plot_not_available() -> None:
    """plot() raises PlotNotAvailableError for unrecognised plot type
    so the API layer can map it to HTTP 404 (Issue #355).

    Bare ``ValueError`` was too coarse — the API funneled it through
    ``except Exception: raise BackendError`` and returned 500, hiding
    a 4xx-shaped condition behind a server-error envelope.
    """
    import pytest

    from lizystudio.backends.exceptions import PlotNotAvailableError

    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    with pytest.raises(PlotNotAvailableError) as exc_info:
        adapter.plot(mock_model, "nonexistent-plot")

    err = exc_info.value
    assert err.plot_type == "nonexistent-plot"
    assert "learning-curve" in err.available  # known supported plot


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


# --- plot() with kwargs (H-0034) ---


def test_plot_learning_curve_forwards_metrics_filter() -> None:
    """plot('learning-curve', metrics=[...]) forwards the metrics kwarg."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_fig = MagicMock()
    mock_fig.to_json.return_value = '{"data": []}'
    mock_model.plot_learning_curve.return_value = mock_fig

    result = adapter.plot(mock_model, "learning-curve", metrics=["auc", "f1"])

    mock_model.plot_learning_curve.assert_called_once_with(metrics=["auc", "f1"])
    assert isinstance(result, PlotData)


def test_plot_learning_curve_without_metrics_calls_no_kwargs() -> None:
    """plot('learning-curve') without metrics passes no kwargs."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_fig = MagicMock()
    mock_fig.to_json.return_value = '{"data": []}'
    mock_model.plot_learning_curve.return_value = mock_fig

    adapter.plot(mock_model, "learning-curve")

    mock_model.plot_learning_curve.assert_called_once_with()


def test_plot_non_learning_curve_ignores_metrics_kwarg() -> None:
    """plot() ignores the metrics kwarg for non-learning-curve plot types."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_fig = MagicMock()
    mock_fig.to_json.return_value = '{"data": []}'
    mock_model.plot_oof_distribution.return_value = mock_fig

    adapter.plot(mock_model, "oof-distribution", metrics=["auc"])

    mock_model.plot_oof_distribution.assert_called_once_with()


# --- plot("residuals", kind=...) (Issue #457 / P-0105) ---


def test_plot_residuals_forwards_kind() -> None:
    """plot('residuals', kind=...) forwards the kind to residuals_plot()."""
    adapter = LizyMLAdapter()
    for kind in ("scatter", "histogram", "qq", "all"):
        mock_model = MagicMock()
        mock_fig = MagicMock()
        mock_fig.to_json.return_value = '{"data": []}'
        mock_model.residuals_plot.return_value = mock_fig

        result = adapter.plot(mock_model, "residuals", kind=kind)

        mock_model.residuals_plot.assert_called_once_with(kind=kind)
        assert isinstance(result, PlotData)


def test_plot_residuals_without_kind_calls_no_kwargs() -> None:
    """plot('residuals') without kind passes no kwargs (lizyml defaults to 'all')."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_fig = MagicMock()
    mock_fig.to_json.return_value = '{"data": []}'
    mock_model.residuals_plot.return_value = mock_fig

    adapter.plot(mock_model, "residuals")

    mock_model.residuals_plot.assert_called_once_with()


def test_residuals_kinds_constant_matches_lizyml() -> None:
    """RESIDUALS_KINDS mirrors lizyml ``plot_residuals._VALID_KINDS``."""
    from lizyml.plots.residuals import _VALID_KINDS

    assert LizyMLAdapter.RESIDUALS_KINDS == ("scatter", "histogram", "qq", "all")
    assert tuple(LizyMLAdapter.RESIDUALS_KINDS) == tuple(_VALID_KINDS)


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


# ---------------------------------------------------------------------------
# load_config_from_file edge cases (#11)
# ---------------------------------------------------------------------------


class TestLoadConfigEdgeCases:
    """Edge cases for load_config_from_file."""

    def test_invalid_yaml(self) -> None:
        """Malformed YAML raises an error."""
        import yaml

        adapter = LizyMLAdapter()
        with pytest.raises((yaml.YAMLError, ValueError)):
            adapter.load_config_from_file(b":\n  :\n  : [bad", "bad.yaml")

    def test_invalid_json(self) -> None:
        """Malformed JSON raises json.JSONDecodeError."""
        import json

        adapter = LizyMLAdapter()
        with pytest.raises(json.JSONDecodeError):
            adapter.load_config_from_file(b"{{not json", "bad.json")

    def test_non_mapping_yaml(self) -> None:
        """YAML that parses to a list raises ValueError."""
        adapter = LizyMLAdapter()
        with pytest.raises(ValueError, match="Expected a mapping"):
            adapter.load_config_from_file(b"- item1\n- item2\n", "list.yaml")

    def test_non_mapping_json(self) -> None:
        """JSON that parses to an array raises ValueError."""
        adapter = LizyMLAdapter()
        with pytest.raises(ValueError, match="Expected a mapping"):
            adapter.load_config_from_file(b"[1, 2, 3]", "array.json")

    def test_empty_content_yaml(self) -> None:
        """Empty bytes with .yaml extension raises ValueError."""
        adapter = LizyMLAdapter()
        # yaml.safe_load("") returns None → not a dict
        with pytest.raises(ValueError, match="Expected a mapping"):
            adapter.load_config_from_file(b"", "empty.yaml")

    def test_ambiguous_extension_yaml_fallback(self) -> None:
        """Non-yaml/json extension tries YAML first."""
        adapter = LizyMLAdapter()
        result = adapter.load_config_from_file(
            b"task: binary\nmodel:\n  name: lgbm\n", "config.txt"
        )
        assert result["task"] == "binary"

    def test_ambiguous_extension_json_fallback(self) -> None:
        """Non-yaml/json extension falls back to JSON."""
        adapter = LizyMLAdapter()
        result = adapter.load_config_from_file(b'{"task": "binary"}', "config.txt")
        assert result["task"] == "binary"


# ---------------------------------------------------------------------------
# Integration-style tests using real lizyml types (guards against mock drift)
# ---------------------------------------------------------------------------


def test_tune_serializes_real_lizyml_tuning_result() -> None:
    """End-to-end: adapter consumes a real lizyml.TuningResult dataclass.

    Guards against the "mock-circular" failure mode where MagicMock-based
    tests pass even when the serializer's attribute expectations diverge
    from the actual lizyml 0.9.0 shape.
    """
    from lizyml.core.types.search_dim import FloatDim
    from lizyml.core.types.tuning_result import (
        BoundaryDimStatus,
        BoundaryReport,
        RoundSummary,
        TrialResult,
        TuningResult,
    )

    space = (FloatDim(name="lr", low=1e-4, high=1e-1, log=True),)

    round1 = RoundSummary(
        round=1,
        n_trials=10,
        best_score_before=None,
        best_score_after=0.85,
        expanded_dims=(),
        space_snapshot=space,
    )
    round2 = RoundSummary(
        round=2,
        n_trials=10,
        best_score_before=0.85,
        best_score_after=0.87,
        expanded_dims=("lr",),
        space_snapshot=space,
    )

    dim_status = BoundaryDimStatus(
        name="lr",
        best_value=0.003,
        low=1e-4,
        high=1e-1,
        position_pct=0.25,
        edge="none",
        expanded=False,
        new_low=None,
        new_high=None,
    )
    report = BoundaryReport(dims=(dim_status,), expanded_names=())

    trial = TrialResult(
        number=0, params={"lr": 0.003}, score=0.87, state="complete", round=2
    )

    real_result = TuningResult(
        best_model_params={"lr": 0.003},
        best_smart_params={},
        best_training_params={},
        best_score=0.87,
        trials=[trial],
        metric_name="auc",
        direction="maximize",
        rounds=(round1, round2),
        boundary_report=report,
    )

    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = real_result

    summary = adapter.tune(mock_model, re_tune={"n_rounds": 2})

    # rounds are serialized from a real tuple[RoundSummary, ...]
    assert summary.rounds is not None
    assert len(summary.rounds) == 2
    assert summary.rounds[0]["round"] == 1
    assert summary.rounds[0]["best_score_before"] is None
    assert summary.rounds[1]["expanded_dims"] == ["lr"]
    # space_snapshot captures SearchDim type label via class name
    assert summary.rounds[0]["space_snapshot"][0]["type"] == "float"
    assert summary.rounds[0]["space_snapshot"][0]["category"] == "model"

    # boundary_report round-trips
    assert summary.boundary_report is not None
    assert len(summary.boundary_report["dims"]) == 1
    assert summary.boundary_report["dims"][0]["edge"] == "none"
    assert summary.boundary_report["dims"][0]["expanded"] is False

    # TrialResult.round is preserved and .best_params flattens dicts
    assert summary.trials[0]["round"] == 2
    assert summary.best_params == {"lr": 0.003}


def test_tuning_summary_backward_compat_old_json_shape() -> None:
    """TuningSummary(**old_dict) accepts legacy JSON without rounds/boundary_report.

    Guards against JobMetadataStore.load_job failing to rehydrate jobs that
    were persisted before H-0061 landed.
    """
    from lizystudio.backends.types import TuningSummary

    old = {
        "best_params": {"lr": 0.01},
        "best_score": 0.9,
        "trials": [
            {"number": 0, "params": {"lr": 0.01}, "score": 0.9, "state": "complete"}
        ],
        "metric_name": "auc",
        "direction": "maximize",
    }
    rehydrated = TuningSummary(**old)
    assert rehydrated.rounds is None
    assert rehydrated.boundary_report is None
    assert rehydrated.best_score == 0.9


def test_tune_real_tuning_result_empty_rounds_yields_none() -> None:
    """An empty rounds tuple maps to TuningSummary.rounds=None (not []).

    The UI uses ``rounds != null`` as the render gate; ``rounds=()`` from
    a single-round tune must land as None so the RetuneDashboard shell
    collapses correctly.
    """
    from lizyml.core.types.tuning_result import TrialResult, TuningResult

    real_result = TuningResult(
        best_model_params={"lr": 0.01},
        best_smart_params={},
        best_training_params={},
        best_score=0.9,
        trials=[
            TrialResult(number=0, params={"lr": 0.01}, score=0.9, state="complete")
        ],
        metric_name="auc",
        direction="maximize",
        # rounds defaults to () — the legacy single-round path
        boundary_report=None,
    )

    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = real_result

    summary = adapter.tune(mock_model)
    assert summary.rounds is None
    assert summary.boundary_report is None
    assert summary.best_params == {"lr": 0.01}


class TestGetIncompatibleMetrics:
    """LizyMLAdapter.get_incompatible_metrics — the regression-metric watchlist
    (mape / rmsle / r2 + the sMAPE/WAPE suggestion text) that P-0106 (#403)
    moved off the Service layer and behind the BackendCore Protocol.
    """

    @pytest.fixture
    def adapter(self) -> LizyMLAdapter:
        return LizyMLAdapter()

    def test_mape_with_zero_target(self, adapter: LizyMLAdapter) -> None:
        out = adapter.get_incompatible_metrics(
            "regression", pd.Series([0.0, 1.0, 2.0], name="y"), {"mape", "mae"}
        )
        assert all(isinstance(m, IncompatibleMetric) for m in out)
        assert [m.metric for m in out] == ["mape"]
        assert "zero" in out[0].message.lower()
        assert "'y'" in out[0].message
        assert "smape" in out[0].suggested_fix.lower()
        assert "wape" in out[0].suggested_fix.lower()

    def test_mape_clean_when_no_zero(self, adapter: LizyMLAdapter) -> None:
        assert (
            adapter.get_incompatible_metrics(
                "regression", pd.Series([1.0, 2.0, 3.0], name="y"), {"mape"}
            )
            == []
        )

    def test_rmsle_with_negative_target(self, adapter: LizyMLAdapter) -> None:
        out = adapter.get_incompatible_metrics(
            "regression", pd.Series([-1.0, 1.0, 2.0], name="y"), {"rmsle"}
        )
        assert [m.metric for m in out] == ["rmsle"]
        assert "negative" in out[0].message.lower()

    def test_rmsle_clean_when_nonnegative(self, adapter: LizyMLAdapter) -> None:
        # exact zero is allowed for RMSLE (log1p(0) == 0), only negatives fail
        assert (
            adapter.get_incompatible_metrics(
                "regression", pd.Series([0.0, 1.0, 2.0], name="y"), {"rmsle"}
            )
            == []
        )

    def test_r2_with_constant_target(self, adapter: LizyMLAdapter) -> None:
        out = adapter.get_incompatible_metrics(
            "regression", pd.Series([5.0, 5.0, 5.0], name="y"), {"r2"}
        )
        assert [m.metric for m in out] == ["r2"]
        assert "constant" in out[0].message.lower()

    def test_r2_clean_when_target_varies(self, adapter: LizyMLAdapter) -> None:
        assert (
            adapter.get_incompatible_metrics(
                "regression", pd.Series([1.0, 2.0, 3.0], name="y"), {"r2"}
            )
            == []
        )

    def test_r2_single_observation_flagged(self, adapter: LizyMLAdapter) -> None:
        # std() of <2 non-null observations is NaN → "cannot compute R²"
        out = adapter.get_incompatible_metrics(
            "regression", pd.Series([5.0], name="y"), {"r2"}
        )
        assert [m.metric for m in out] == ["r2"]

    def test_multiple_issues_one_entry_each(self, adapter: LizyMLAdapter) -> None:
        # all-zero target: mape (zeros) + r2 (constant) fire; rmsle needs negatives
        out = adapter.get_incompatible_metrics(
            "regression",
            pd.Series([0.0, 0.0, 0.0], name="y"),
            {"mape", "rmsle", "r2"},
        )
        assert sorted(m.metric for m in out) == ["mape", "r2"]

    def test_unwatched_metrics_ignored(self, adapter: LizyMLAdapter) -> None:
        assert (
            adapter.get_incompatible_metrics(
                "regression", pd.Series([0.0, 1.0], name="y"), {"mae", "rmse", "auc"}
            )
            == []
        )

    def test_non_regression_task_returns_empty(self, adapter: LizyMLAdapter) -> None:
        # a constant 0/1 binary target must NOT surface a misleading R² warning
        assert (
            adapter.get_incompatible_metrics(
                "binary", pd.Series([0, 0, 0], name="label"), {"r2", "mape"}
            )
            == []
        )
        assert (
            adapter.get_incompatible_metrics(
                "multiclass", pd.Series([1.0], name="y"), {"r2"}
            )
            == []
        )
        # absent task ("") is treated as non-regression
        assert (
            adapter.get_incompatible_metrics("", pd.Series([0.0], name="y"), {"r2"})
            == []
        )

    def test_non_numeric_target_returns_empty(self, adapter: LizyMLAdapter) -> None:
        assert (
            adapter.get_incompatible_metrics(
                "regression",
                pd.Series(["a", "b", "c"], name="y"),
                {"mape", "rmsle", "r2"},
            )
            == []
        )

    def test_empty_metric_set_returns_empty(self, adapter: LizyMLAdapter) -> None:
        assert (
            adapter.get_incompatible_metrics(
                "regression", pd.Series([0.0, 1.0], name="y"), set()
            )
            == []
        )

    def test_all_nan_target_flags_only_r2(self, adapter: LizyMLAdapter) -> None:
        # NaN comparisons are False, so mape/rmsle stay quiet; std() is NaN → r2
        out = adapter.get_incompatible_metrics(
            "regression",
            pd.Series([float("nan")] * 5, name="y"),
            {"mape", "rmsle", "r2"},
        )
        assert [m.metric for m in out] == ["r2"]

    @pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning")
    def test_inf_in_target_does_not_crash(self, adapter: LizyMLAdapter) -> None:
        # +inf is not 0 and not < 0; -inf qualifies as negative → rmsle.
        # std with non-finite values is NaN → r2. mape stays quiet (no exact 0).
        out = adapter.get_incompatible_metrics(
            "regression",
            pd.Series([float("inf"), float("-inf"), 1.0, 2.0, 3.0], name="y"),
            {"mape", "rmsle", "r2"},
        )
        assert sorted(m.metric for m in out) == ["r2", "rmsle"]


class TestValidateSearchSpace:
    """LizyMLAdapter.validate_search_space — P-0108 / Issue #474.

    The run-gate must reject the two structurally-broken cases lizyml's
    ``parse_space()`` cannot evaluate even in principle (inverted Range,
    log + low<=0) while leaving the empty-choices categorical case to
    the frontend's ``empty-choice-banner``.
    """

    @pytest.fixture
    def adapter(self) -> LizyMLAdapter:
        return LizyMLAdapter()

    def test_empty_space_returns_empty(self, adapter: LizyMLAdapter) -> None:
        assert adapter.validate_search_space({}) == []

    def test_non_dict_space_returns_empty(self, adapter: LizyMLAdapter) -> None:
        # Defensive: malformed configs can arrive here mid-edit.
        assert adapter.validate_search_space([1, 2, 3]) == []  # type: ignore[arg-type]
        assert adapter.validate_search_space(None) == []  # type: ignore[arg-type]

    def test_valid_space_returns_empty(self, adapter: LizyMLAdapter) -> None:
        out = adapter.validate_search_space(
            {
                "lr": {"type": "float", "low": 0.01, "high": 0.3, "log": True},
                "num_leaves": {"type": "int", "low": 16, "high": 256},
                "subsample": {"type": "categorical", "choices": [0.6, 1.0]},
            }
        )
        assert out == []

    def test_inverted_range_is_flagged(self, adapter: LizyMLAdapter) -> None:
        out = adapter.validate_search_space(
            {"lr": {"type": "float", "low": 0.5, "high": 0.01}}
        )
        assert len(out) == 1
        err = out[0]
        assert err["path"] == "tuning.optuna.space.lr"
        assert err["severity"] == "error"
        assert "low" in err["message"].lower() and "high" in err["message"].lower()
        assert "lr" in err["suggested_fix"]
        # Suggested fix mentions the actual offending values so the user
        # can paste them directly into the form.
        assert "0.5" in err["suggested_fix"]

    def test_log_with_zero_low_is_flagged(self, adapter: LizyMLAdapter) -> None:
        out = adapter.validate_search_space(
            {"lr": {"type": "float", "low": 0.0, "high": 0.3, "log": True}}
        )
        assert len(out) == 1
        err = out[0]
        assert err["path"] == "tuning.optuna.space.lr"
        assert "log" in err["message"].lower()
        assert "log" in err["suggested_fix"].lower()

    def test_log_with_negative_low_is_flagged(self, adapter: LizyMLAdapter) -> None:
        out = adapter.validate_search_space(
            {"lr": {"type": "float", "low": -1.0, "high": 0.3, "log": True}}
        )
        assert len(out) == 1
        assert out[0]["path"] == "tuning.optuna.space.lr"

    def test_empty_categorical_choices_is_silently_dropped(
        self, adapter: LizyMLAdapter
    ) -> None:
        # INV-E (P-0108): the frontend's empty-choice-banner owns the UX
        # for this case; the run-gate must not return an entry for it.
        out = adapter.validate_search_space(
            {"objective": {"type": "categorical", "choices": []}}
        )
        assert out == []

    def test_multiple_broken_entries_are_each_flagged(
        self, adapter: LizyMLAdapter
    ) -> None:
        # A single broken row must not mask the rest of the space.
        out = adapter.validate_search_space(
            {
                "lr": {"type": "float", "low": 0.5, "high": 0.01},
                "max_depth": {"type": "int", "low": 0.0, "high": 1.0, "log": True},
                "fine": {"type": "float", "low": 0.01, "high": 0.3},
            }
        )
        paths = {err["path"] for err in out}
        assert paths == {
            "tuning.optuna.space.lr",
            "tuning.optuna.space.max_depth",
        }

    def test_non_dict_entry_is_skipped(self, adapter: LizyMLAdapter) -> None:
        # Defensive: tolerates a partially-typed config without crashing.
        out = adapter.validate_search_space(
            {
                "lr": "not_a_dict",  # type: ignore[dict-item]
                "ok": {"type": "float", "low": 0.01, "high": 0.3},
            }
        )
        assert out == []


# ---------------------------------------------------------------------------
# P-0109 PR-3: get_tuning_defaults / compute_effective_tuning
# ---------------------------------------------------------------------------


class TestGetTuningDefaults:
    """Catalog-aware defaults the adapter exposes via ``get_tuning_defaults``.

    These tests pin the SSOT shape (INV-T5: each adapter is the source of
    truth for its own defaults) and the catalog-projection rule (entries
    with ``default_mode`` of "range"/"choice" produce search-space rows;
    "fixed" rows do not).
    """

    @pytest.fixture
    def adapter(self) -> LizyMLAdapter:
        return LizyMLAdapter()

    def test_binary_has_catalog_space_and_metrics_and_maximize_direction(
        self, adapter: LizyMLAdapter
    ) -> None:
        d = adapter.get_tuning_defaults("binary")
        assert d.space, "binary defaults must carry the catalog search space"
        # First canonical metric is "auc" → registry direction maximize.
        assert d.evaluation_metrics == ["auc", "auc_pr", "brier", "logloss"]
        assert d.direction == "maximize"

    def test_regression_has_catalog_space_but_no_canonical_metric_default(
        self, adapter: LizyMLAdapter
    ) -> None:
        # P-0104 Wave 2.3 / Issue #459: only binary has a canonical
        # default metric list today. Regression / multiclass still defer.
        d = adapter.get_tuning_defaults("regression")
        assert d.space, "regression defaults still carry the catalog search space"
        assert d.evaluation_metrics == []
        assert d.direction is None

    def test_multiclass_has_catalog_space_but_no_canonical_metric_default(
        self, adapter: LizyMLAdapter
    ) -> None:
        d = adapter.get_tuning_defaults("multiclass")
        assert d.space, "multiclass defaults still carry the catalog search space"
        assert d.evaluation_metrics == []
        assert d.direction is None

    def test_empty_task_yields_empty_defaults(self, adapter: LizyMLAdapter) -> None:
        d = adapter.get_tuning_defaults("")
        assert d.space == {}
        assert d.evaluation_metrics == []
        assert d.direction is None

    def test_unknown_task_yields_empty_defaults(self, adapter: LizyMLAdapter) -> None:
        d = adapter.get_tuning_defaults("unknown_task")
        assert d.space == {}
        assert d.evaluation_metrics == []
        assert d.direction is None

    def test_space_entries_match_catalog_default_mode_filter(
        self, adapter: LizyMLAdapter
    ) -> None:
        """Only catalog rows with ``default_mode`` of range/choice contribute.

        Pins the projection rule. ``num_leaves`` (modes include range
        but no ``default_mode``) is "fixed" by default and MUST be absent
        from ``defaults.space``; ``learning_rate`` (``default_mode =
        "range"``) MUST be present.
        """
        d = adapter.get_tuning_defaults("binary")
        assert "learning_rate" in d.space
        assert "num_leaves" not in d.space, (
            "num_leaves has no default_mode in the catalog — "
            "it must not appear in the canonical defaults space"
        )

    def test_space_range_entries_have_required_keys(
        self, adapter: LizyMLAdapter
    ) -> None:
        d = adapter.get_tuning_defaults("binary")
        lr = d.space["learning_rate"]
        assert lr["type"] == "float"
        assert lr["low"] == 0.0001
        assert lr["high"] == 0.01
        assert lr["log"] is True

    def test_space_int_range_entry_is_typed_as_int(
        self, adapter: LizyMLAdapter
    ) -> None:
        d = adapter.get_tuning_defaults("binary")
        depth = d.space["max_depth"]
        assert depth["type"] == "int"
        assert depth["low"] == 3
        assert depth["high"] == 9
        assert depth["log"] is False

    def test_space_choice_entry_is_categorical_with_choices(
        self, adapter: LizyMLAdapter
    ) -> None:
        d = adapter.get_tuning_defaults("binary")
        max_bin = d.space["max_bin"]
        assert max_bin["type"] == "categorical"
        assert max_bin["choices"] == [15, 63, 127, 255, 511]

    def test_returns_independent_snapshots_per_call(
        self, adapter: LizyMLAdapter
    ) -> None:
        """Mutating one TuningDefaults must not leak into the next call.

        ``TuningDefaults`` is frozen at the dataclass level but its
        ``space`` dict is not — defending against accidental aliasing
        is part of the contract.
        """
        a = adapter.get_tuning_defaults("binary")
        b = adapter.get_tuning_defaults("binary")
        assert a.space["learning_rate"] is not b.space["learning_rate"], (
            "different calls must yield independent dict instances"
        )


class TestComputeEffectiveTuning:
    """Per-key merge semantics against the real lizyml catalog.

    Mirrors the BackendCore Protocol tests (P-0109 PR-2) but exercises
    the adapter's own override so any regression at the adapter level
    (not the Protocol level) is caught.
    """

    @pytest.fixture
    def adapter(self) -> LizyMLAdapter:
        return LizyMLAdapter()

    def test_empty_overrides_yields_catalog_defaults_for_binary(
        self, adapter: LizyMLAdapter
    ) -> None:
        from lizystudio.backends.types import TuningOverrides

        eff = adapter.compute_effective_tuning("binary", TuningOverrides())
        assert eff.n_trials == 50  # fall-through default
        assert eff.timeout is None
        assert eff.direction == "maximize"  # auc → maximize
        assert eff.evaluation_metrics == ["auc", "auc_pr", "brier", "logloss"]
        assert eff.user_set_paths == []
        assert "learning_rate" in eff.space

    def test_user_override_wins_per_space_key(self, adapter: LizyMLAdapter) -> None:
        from lizystudio.backends.types import TuningOverrides

        o = TuningOverrides(
            space={
                "learning_rate": {
                    "type": "float",
                    "low": 0.5,
                    "high": 1.0,
                    "log": False,
                },
            },
        )
        eff = adapter.compute_effective_tuning("binary", o)
        assert eff.space["learning_rate"]["low"] == 0.5
        assert eff.space["learning_rate"]["high"] == 1.0
        # Catalog-only keys survive intact.
        assert "max_depth" in eff.space
        assert eff.space["max_depth"]["high"] == 9
        assert "space.learning_rate" in eff.user_set_paths
        assert "space.max_depth" not in eff.user_set_paths

    def test_evaluation_metrics_override_replaces_list(
        self, adapter: LizyMLAdapter
    ) -> None:
        from lizystudio.backends.types import TuningOverrides

        o = TuningOverrides(evaluation_metrics=["logloss"])
        eff = adapter.compute_effective_tuning("binary", o)
        assert eff.evaluation_metrics == ["logloss"]
        assert "evaluation_metrics" in eff.user_set_paths

    def test_direction_follows_effective_first_metric_after_override(
        self, adapter: LizyMLAdapter
    ) -> None:
        """P-0109 PR-6b refinement (INV-T3): when *overrides* replace the
        ``evaluation_metrics`` list, ``effective.direction`` follows the
        new first metric via the lizyml metric registry — not the
        catalog's canonical direction. Previously the method returned
        ``defaults.direction`` (``"maximize"`` for binary, since auc is
        first in ``_TASK_DEFAULT_METRICS``) regardless of how the user
        overrode the metric list, which let ``auc → logloss`` ship as
        ``direction="maximize"`` and rely on
        ``_prepare_tune_config``'s legacy ``maximize_metrics`` block to
        silently correct the drift downstream.
        """
        from lizystudio.backends.types import TuningOverrides

        # Override-only: switch from auc (maximize) to logloss (minimize).
        eff = adapter.compute_effective_tuning(
            "binary", TuningOverrides(evaluation_metrics=["logloss"])
        )
        assert eff.direction == "minimize"
        # Symmetric round-trip: switching back to a maximize-metric returns
        # ``"maximize"`` from the registry (not the bare default).
        eff2 = adapter.compute_effective_tuning(
            "binary", TuningOverrides(evaluation_metrics=["auc_pr"])
        )
        assert eff2.direction == "maximize"

    def test_explicit_direction_override_still_wins_over_registry(
        self, adapter: LizyMLAdapter
    ) -> None:
        """A user-supplied ``direction`` ranks above the metric-registry
        derivation: e.g. someone optimising AUC as a *loss surrogate* can
        still pin ``direction="minimize"`` and have it survive the
        refinement. Symmetric upgrade: setting ``direction="maximize"``
        with a logloss metric also survives — the registry only acts
        as a default, never as a hard override on user intent."""
        from lizystudio.backends.types import TuningOverrides

        eff = adapter.compute_effective_tuning(
            "binary",
            TuningOverrides(evaluation_metrics=["auc"], direction="minimize"),
        )
        assert eff.direction == "minimize"
        eff2 = adapter.compute_effective_tuning(
            "binary",
            TuningOverrides(evaluation_metrics=["logloss"], direction="maximize"),
        )
        assert eff2.direction == "maximize"

    def test_direction_falls_back_to_catalog_default_for_unknown_metric(
        self, adapter: LizyMLAdapter
    ) -> None:
        """When the override metric is not in the lizyml registry, the
        derivation step returns ``None`` and the merge falls back to the
        catalog's canonical direction (``defaults.direction``). For
        binary that is ``"maximize"`` (auc is the canonical first metric).
        This keeps a user-added custom metric from accidentally flipping
        the tuner's direction toward "minimize" when the catalog default
        was "maximize"."""
        from lizystudio.backends.types import TuningOverrides

        eff = adapter.compute_effective_tuning(
            "binary",
            TuningOverrides(evaluation_metrics=["custom_unknown_metric"]),
        )
        assert eff.direction == "maximize"  # catalog canonical for binary

    def test_direction_dict_form_metric_uses_registry(
        self, adapter: LizyMLAdapter
    ) -> None:
        """MetricEntry dict form (``{"precision_at_k": {"k": 10}}``) is
        accepted: direction derivation extracts the metric name (first
        key) before consulting the registry. precision_at_k is a
        maximize metric in the lizyml registry."""
        from lizystudio.backends.types import TuningOverrides

        eff = adapter.compute_effective_tuning(
            "binary",
            TuningOverrides(evaluation_metrics=[{"precision_at_k": {"k": 10}}]),
        )
        assert eff.direction == "maximize"

    def test_direction_override_wins_over_catalog(self, adapter: LizyMLAdapter) -> None:
        from lizystudio.backends.types import TuningOverrides

        o = TuningOverrides(direction="minimize")
        eff = adapter.compute_effective_tuning("binary", o)
        assert eff.direction == "minimize"
        assert "direction" in eff.user_set_paths

    def test_explicit_timeout_none_is_tracked(self, adapter: LizyMLAdapter) -> None:
        from lizystudio.backends.types import TuningOverrides

        eff = adapter.compute_effective_tuning("binary", TuningOverrides(timeout=None))
        assert eff.timeout is None
        assert "timeout" in eff.user_set_paths

    def test_catalog_outside_user_param_survives(self, adapter: LizyMLAdapter) -> None:
        """INV-T2: user-added space keys outside the catalog must persist."""
        from lizystudio.backends.types import TuningOverrides

        o = TuningOverrides(
            space={
                "custom_param": {
                    "type": "categorical",
                    "choices": ["a", "b"],
                },
            },
        )
        eff = adapter.compute_effective_tuning("binary", o)
        assert "custom_param" in eff.space
        assert eff.space["custom_param"]["choices"] == ["a", "b"]
        # Catalog keys also still present.
        assert "learning_rate" in eff.space

    def test_unknown_task_falls_back_to_overrides_only(
        self, adapter: LizyMLAdapter
    ) -> None:
        """Defaults are empty for unknown task — overrides surface verbatim."""
        from lizystudio.backends.types import TuningOverrides

        o = TuningOverrides(
            n_trials=10,
            space={"x": {"type": "float", "low": 0.1, "high": 0.5}},
        )
        eff = adapter.compute_effective_tuning("unknown", o)
        assert eff.n_trials == 10
        assert eff.space == {"x": {"type": "float", "low": 0.1, "high": 0.5}}
        assert eff.direction == "minimize"  # no catalog default → fallback
        assert eff.evaluation_metrics == []

    def test_pure_function_does_not_mutate_overrides(
        self, adapter: LizyMLAdapter
    ) -> None:
        from lizystudio.backends.types import TuningOverrides

        space_in: dict[str, dict[str, Any]] = {
            "learning_rate": {
                "type": "float",
                "low": 0.5,
                "high": 1.0,
                "log": False,
            }
        }
        o = TuningOverrides(space=space_in)
        _ = adapter.compute_effective_tuning("binary", o)
        assert o.space == {
            "learning_rate": {
                "type": "float",
                "low": 0.5,
                "high": 1.0,
                "log": False,
            }
        }
