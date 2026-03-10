"""Tests for training service (run_fit, run_tune)."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

from lizystudio.backends.types import (
    DataRef,
    FitSummary,
    TuningSummary,
)
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import run_fit, run_tune


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
    progress_calls: list[dict[str, Any]] = []

    def on_progress(*, current: int, total: int, message: str) -> None:
        progress_calls.append({"current": current, "total": total, "message": message})

    run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={},
        dataframe=sample_df,
        on_progress=on_progress,
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
    assert result.status == "completed"
    assert result.tune_result is not None
    assert result.tune_result.best_score == 0.95
    assert result.fit_result is not None  # Auto-fit after tune
    assert result.model_path is not None

    # Verify create_model called twice (tune + auto-fit)
    assert mock_backend.create_model.call_count == 2
    # Verify fit was called with best_params
    mock_backend.fit.assert_called_once()
    call_kwargs = mock_backend.fit.call_args[1]
    assert call_kwargs["params"] == {"lr": 0.01}


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
