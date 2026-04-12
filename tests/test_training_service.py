"""Tests for training service (run_fit, run_tune, config helpers)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pandas as pd
import pytest

from lizystudio.backends.types import (
    DataRef,
    FitSummary,
    TuningSummary,
)
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import (
    _extract_re_tune,
    _prepare_autofit_config,
    _prepare_tune_config,
    run_fit,
    run_tune,
)

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


@pytest.fixture()
def sample_df() -> pd.DataFrame:
    return pd.DataFrame({"x": [1, 2, 3], "y": [0, 1, 0]})


@pytest.fixture()
def mock_backend() -> MagicMock:
    backend = MagicMock()
    backend.create_model.return_value = MagicMock()
    backend.fit.return_value = FitSummary(
        metrics={"auc": 0.9}, fold_count=5, params=[{"n_estimators": 100}]
    )
    backend.tune.return_value = TuningSummary(
        best_params={"lr": 0.01},
        best_score=0.95,
        trials=[{"number": 1, "score": 0.95, "params": {"lr": 0.01}}],
        metric_name="auc",
        direction="maximize",
    )
    backend.export_model.return_value = "/tmp/model"
    return backend


def test_run_fit_success(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    result = run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={"task": "binary"},
        dataframe=sample_df,
    )
    assert result.status == "completed"
    assert result.fit_result is not None
    assert result.fit_result.metrics["auc"] == 0.9
    assert result.model_path is not None
    assert result.completed_at is not None

    # Verify persisted
    loaded = job_store.get(job.job_id)
    assert loaded is not None
    assert loaded.status == "completed"


def test_run_fit_with_progress(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={},
        dataframe=sample_df,
    )
    # Verify a progress callback was passed to backend.fit
    mock_backend.fit.assert_called_once()
    call_kwargs = mock_backend.fit.call_args[1]
    assert callable(call_kwargs["on_progress"])


def test_run_fit_failure(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    mock_backend.fit.side_effect = RuntimeError("Training failed")
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    result = run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={},
        dataframe=sample_df,
    )
    assert result.status == "failed"
    assert "Training failed" in (result.error or "")
    assert result.completed_at is not None


def test_run_tune_success(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    config = {
        "task": "binary",
        "model": {"name": "lgbm", "params": {"n_estimators": 100}},
    }
    job = job_store.create(
        backend_name="lizyml",
        config=config,
        data_ref=sample_data_ref,
        job_type="tune",
    )
    result = run_tune(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config=config,
        dataframe=sample_df,
    )
    assert result.status == "completed"
    assert result.tune_result is not None
    assert result.tune_result.best_score == 0.95
    assert result.fit_result is not None  # Auto-fit after tune
    assert result.model_path is not None

    # Verify create_model called twice (tune + auto-fit)
    assert mock_backend.create_model.call_count == 2
    # Auto-fit config should merge best_params into original model.params
    autofit_config = mock_backend.create_model.call_args_list[1][0][0]
    assert autofit_config["model"]["params"] == {"n_estimators": 100, "lr": 0.01}
    assert "tuning" not in autofit_config
    # fit() called without params kwarg (params baked into config)
    mock_backend.fit.assert_called_once()
    call_kwargs = mock_backend.fit.call_args[1]
    assert "params" not in call_kwargs


def test_run_tune_failure(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    mock_backend.tune.side_effect = ValueError("Tune error")
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    result = run_tune(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={},
        dataframe=sample_df,
    )
    assert result.status == "failed"
    assert "Tune error" in (result.error or "")


# ---------------------------------------------------------------------------
# Config propagation: run_fit receives the exact config passed to it
# ---------------------------------------------------------------------------


def test_run_fit_propagates_config_to_backend(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """Verify that run_fit forwards the config dict to backend.create_model."""
    config = {
        "task": "binary",
        "model": {"name": "lgbm", "params": {"n_estimators": 200}},
    }
    job = job_store.create(
        backend_name="lizyml",
        config=config,
        data_ref=sample_data_ref,
        job_type="fit",
    )
    run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config=config,
        dataframe=sample_df,
    )
    actual_config = mock_backend.create_model.call_args[0][0]
    assert actual_config == config
    assert actual_config["model"]["params"]["n_estimators"] == 200


def test_run_fit_config_change_propagates(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """After changing config, a second run_fit must use the new config."""
    config_a = {"task": "binary", "model": {"name": "lgbm", "params": {"lr": 0.1}}}
    config_b = {"task": "binary", "model": {"name": "lgbm", "params": {"lr": 0.01}}}

    job_a = job_store.create(
        backend_name="lizyml",
        config=config_a,
        data_ref=sample_data_ref,
        job_type="fit",
    )
    run_fit(
        job=job_a,
        job_store=job_store,
        backend=mock_backend,
        config=config_a,
        dataframe=sample_df,
    )

    job_b = job_store.create(
        backend_name="lizyml",
        config=config_b,
        data_ref=sample_data_ref,
        job_type="fit",
    )
    run_fit(
        job=job_b,
        job_store=job_store,
        backend=mock_backend,
        config=config_b,
        dataframe=sample_df,
    )

    calls = mock_backend.create_model.call_args_list
    assert calls[0][0][0]["model"]["params"]["lr"] == 0.1
    assert calls[1][0][0]["model"]["params"]["lr"] == 0.01


# ---------------------------------------------------------------------------
# _prepare_tune_config unit tests
# ---------------------------------------------------------------------------


class TestPrepareTuneConfig:
    """Unit tests for _prepare_tune_config helper."""

    def test_merges_evaluation(self) -> None:
        """tuning.evaluation overrides top-level evaluation."""
        config = {
            "task": "binary",
            "evaluation": {"metrics": ["logloss"]},
            "tuning": {
                "evaluation": {"metrics": ["auc"]},
                "optuna": {"params": {"n_trials": 5}},
            },
        }
        result = _prepare_tune_config(config)
        assert result["evaluation"]["metrics"] == ["auc"]

    def test_merges_model_params(self) -> None:
        """tuning.model_params merges into model.params, filtering _ prefixed."""
        config = {
            "task": "binary",
            "model": {"name": "lgbm", "params": {"n_estimators": 100}},
            "tuning": {
                "model_params": {"learning_rate": 0.05, "_internal": True},
                "optuna": {"params": {"n_trials": 3}},
            },
        }
        result = _prepare_tune_config(config)
        assert result["model"]["params"]["learning_rate"] == 0.05
        assert result["model"]["params"]["n_estimators"] == 100
        assert "_internal" not in result["model"]["params"]

    def test_merges_training(self) -> None:
        """tuning.training merges into top-level training."""
        config = {
            "task": "binary",
            "training": {"seed": 42, "n_splits": 5},
            "tuning": {
                "training": {"n_splits": 3},
                "optuna": {"params": {"n_trials": 5}},
            },
        }
        result = _prepare_tune_config(config)
        assert result["training"]["n_splits"] == 3
        assert result["training"]["seed"] == 42

    def test_default_metric_for_binary(self) -> None:
        """Empty evaluation.metrics defaults to ["auc"] for binary task."""
        config = {
            "task": "binary",
            "tuning": {"optuna": {"params": {"n_trials": 3}}},
        }
        result = _prepare_tune_config(config)
        assert result["evaluation"]["metrics"] == ["auc"]

    def test_default_metric_for_regression(self) -> None:
        """Empty evaluation.metrics defaults to ["rmse"] for regression task."""
        config = {
            "task": "regression",
            "tuning": {"optuna": {"params": {"n_trials": 3}}},
        }
        result = _prepare_tune_config(config)
        assert result["evaluation"]["metrics"] == ["rmse"]

    def test_resolves_direction_maximize(self) -> None:
        """Direction is auto-resolved to "maximize" for auc metric."""
        config = {
            "task": "binary",
            "evaluation": {"metrics": ["auc"]},
            "tuning": {"optuna": {"params": {"n_trials": 3}}},
        }
        result = _prepare_tune_config(config)
        assert result["tuning"]["optuna"]["params"]["direction"] == "maximize"

    def test_resolves_direction_minimize(self) -> None:
        """Direction is auto-resolved to "minimize" for rmse metric."""
        config = {
            "task": "regression",
            "evaluation": {"metrics": ["rmse"]},
            "tuning": {"optuna": {"params": {"n_trials": 3}}},
        }
        result = _prepare_tune_config(config)
        assert result["tuning"]["optuna"]["params"]["direction"] == "minimize"

    def test_strips_non_optuna_keys(self) -> None:
        """Tuning section is cleaned to keep only optuna."""
        config = {
            "task": "binary",
            "evaluation": {"metrics": ["auc"]},
            "tuning": {
                "evaluation": {"metrics": ["auc"]},
                "model_params": {"lr": 0.1},
                "training": {"n_splits": 3},
                "optuna": {"params": {"n_trials": 5}},
            },
        }
        result = _prepare_tune_config(config)
        assert set(result["tuning"].keys()) == {"optuna"}

    def test_does_not_mutate_original(self) -> None:
        """Input config must not be mutated."""
        config = {
            "task": "binary",
            "model": {"name": "lgbm", "params": {"n_estimators": 100}},
            "tuning": {
                "model_params": {"lr": 0.05},
                "optuna": {"params": {"n_trials": 3}},
            },
        }
        import copy

        original = copy.deepcopy(config)
        _prepare_tune_config(config)
        assert config == original


# ---------------------------------------------------------------------------
# _prepare_autofit_config unit tests
# ---------------------------------------------------------------------------


class TestPrepareAutofitConfig:
    """Unit tests for _prepare_autofit_config helper."""

    def test_merges_best_params(self) -> None:
        """best_params are merged into model.params."""
        config = {
            "task": "binary",
            "model": {"name": "lgbm", "params": {"n_estimators": 100}},
            "tuning": {"optuna": {"params": {"n_trials": 5}}},
        }
        result = _prepare_autofit_config(config, {"lr": 0.01, "max_depth": 6})
        assert result["model"]["params"] == {
            "n_estimators": 100,
            "lr": 0.01,
            "max_depth": 6,
        }

    def test_removes_tuning_section(self) -> None:
        """Tuning section is removed from the output config."""
        config = {
            "task": "binary",
            "model": {"name": "lgbm", "params": {}},
            "tuning": {"optuna": {"params": {"n_trials": 5}}},
        }
        result = _prepare_autofit_config(config, {"lr": 0.01})
        assert "tuning" not in result

    def test_does_not_mutate_original(self) -> None:
        """Input config must not be mutated."""
        config = {
            "task": "binary",
            "model": {"name": "lgbm", "params": {"n_estimators": 100}},
            "tuning": {"optuna": {}},
        }
        import copy

        original = copy.deepcopy(config)
        _prepare_autofit_config(config, {"lr": 0.01})
        assert config == original


# ---------------------------------------------------------------------------
# Edge cases: empty/problematic DataFrames (#2)
# ---------------------------------------------------------------------------


def test_run_fit_empty_dataframe(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_backend: MagicMock,
) -> None:
    """Empty DataFrame passed to run_fit propagates backend error."""
    empty_df = pd.DataFrame()
    mock_backend.create_model.side_effect = ValueError("Empty data")
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    result = run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={"task": "binary"},
        dataframe=empty_df,
    )
    assert result.status == "failed"
    assert "Empty data" in (result.error or "")


def test_run_fit_dataframe_with_nan(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """DataFrame with NaN values is delegated to backend."""
    import numpy as np

    nan_df = sample_df.copy()
    nan_df.loc[0, "x"] = np.nan
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    result = run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={"task": "binary"},
        dataframe=nan_df,
    )
    # NaN handling is backend responsibility — job should complete
    assert result.status == "completed"
    mock_backend.create_model.assert_called_once()


def test_run_fit_dataframe_with_inf(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_backend: MagicMock,
) -> None:
    """DataFrame with inf values is delegated to backend."""
    import numpy as np

    inf_df = pd.DataFrame({"x": [1.0, np.inf, 3.0], "y": [0, 1, 0]})
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    result = run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={"task": "binary"},
        dataframe=inf_df,
    )
    assert result.status == "completed"


# ---------------------------------------------------------------------------
# Concurrent job prevention (#8)
# ---------------------------------------------------------------------------


def test_concurrent_fit_blocked(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """Second run_fit fails when another job is already active."""
    # Claim active slot manually
    job_store.claim_active("existing_job")

    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    result = run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={"task": "binary"},
        dataframe=sample_df,
    )
    assert result.status == "failed"
    assert "Another job is already running" in (result.error or "")

    job_store.release_active("existing_job")


def test_concurrent_tune_blocked(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """Second run_tune fails when another job is already active."""
    job_store.claim_active("existing_job")

    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    result = run_tune(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={"task": "binary"},
        dataframe=sample_df,
    )
    assert result.status == "failed"
    assert "Another job is already running" in (result.error or "")

    job_store.release_active("existing_job")


# ---------------------------------------------------------------------------
# _extract_re_tune + run_tune re_tune pass-through (H-0061)
# ---------------------------------------------------------------------------


class TestExtractReTune:
    def test_returns_none_when_no_tuning_section(self) -> None:
        assert _extract_re_tune({"task": "binary"}) is None

    def test_returns_none_when_tuning_has_no_re_tune(self) -> None:
        assert _extract_re_tune({"tuning": {"optuna": {}}}) is None

    def test_returns_shallow_copy_of_re_tune_block(self) -> None:
        config = {
            "tuning": {
                "re_tune": {
                    "n_rounds": 3,
                    "expand_boundary": True,
                    "boundary_threshold": 0.05,
                }
            }
        }
        result = _extract_re_tune(config)
        assert result == {
            "n_rounds": 3,
            "expand_boundary": True,
            "boundary_threshold": 0.05,
        }
        assert result is not None
        result["n_rounds"] = 999
        assert config["tuning"]["re_tune"]["n_rounds"] == 3

    def test_non_dict_re_tune_yields_none(self) -> None:
        assert _extract_re_tune({"tuning": {"re_tune": "bad"}}) is None


def test_run_tune_forwards_re_tune_to_backend(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    config = {
        "task": "binary",
        "model": {"name": "lgbm", "params": {}},
        "tuning": {
            "re_tune": {
                "n_rounds": 3,
                "expand_boundary": True,
                "boundary_threshold": 0.1,
            }
        },
    }
    job = job_store.create(
        backend_name="lizyml",
        config=config,
        data_ref=sample_data_ref,
        job_type="tune",
    )
    run_tune(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config=config,
        dataframe=sample_df,
    )
    mock_backend.tune.assert_called_once()
    call_kwargs = mock_backend.tune.call_args.kwargs
    assert call_kwargs["re_tune"] == {
        "n_rounds": 3,
        "expand_boundary": True,
        "boundary_threshold": 0.1,
    }


def test_run_tune_without_re_tune_passes_none(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    config = {
        "task": "binary",
        "model": {"name": "lgbm", "params": {}},
    }
    job = job_store.create(
        backend_name="lizyml",
        config=config,
        data_ref=sample_data_ref,
        job_type="tune",
    )
    run_tune(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config=config,
        dataframe=sample_df,
    )
    mock_backend.tune.assert_called_once()
    assert mock_backend.tune.call_args.kwargs["re_tune"] is None
