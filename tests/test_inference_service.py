"""Tests for inference service (InferenceStore, run_inference)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.inference import (
    InferenceRecord,
    InferenceStore,
    get_comparison_stats,
)


@pytest.fixture()
def inf_store(tmp_path: Path) -> InferenceStore:
    return InferenceStore(tmp_path / "jobs")


@pytest.fixture()
def sample_record() -> InferenceRecord:
    return InferenceRecord(
        inf_id="inf_abc12345",
        job_id="job_test001",
        data_ref=DataRef(
            source_type="path",
            path="/data/test.csv",
            filename="test.csv",
            fingerprint="xyz789",
            shape=(50, 5),
        ),
        has_ground_truth=True,
        created_at="2026-01-01T00:00:00+00:00",
        row_count=50,
        warnings=[],
    )


@pytest.fixture()
def sample_predictions() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "pred": [0.1, 0.9, 0.3, 0.8, 0.5],
            "actual": [0, 1, 0, 1, 1],
        }
    )


# --- InferenceStore CRUD ---


def test_save_and_get(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    metrics = {"mae": 0.1, "r2": 0.9}
    inf_store.save(sample_record, sample_predictions, metrics)

    loaded = inf_store.get(sample_record.job_id, sample_record.inf_id)
    assert loaded is not None
    assert loaded.inf_id == sample_record.inf_id
    assert loaded.job_id == sample_record.job_id
    assert loaded.has_ground_truth is True
    assert loaded.row_count == 50
    assert loaded.data_ref.shape == (50, 5)


def test_get_nonexistent(inf_store: InferenceStore) -> None:
    assert inf_store.get("job_x", "inf_x") is None


def test_list_empty(inf_store: InferenceStore) -> None:
    assert inf_store.list("job_x") == []


def test_list_multiple(
    inf_store: InferenceStore,
    sample_predictions: pd.DataFrame,
) -> None:
    for i in range(3):
        record = InferenceRecord(
            inf_id=f"inf_{i:08d}",
            job_id="job_test001",
            data_ref=DataRef(
                source_type="path",
                path=f"/data/test{i}.csv",
                filename=f"test{i}.csv",
                fingerprint=f"fp{i}",
                shape=(10, 2),
            ),
            has_ground_truth=False,
            created_at=f"2026-01-0{i + 1}T00:00:00+00:00",
            row_count=10,
            warnings=[],
        )
        inf_store.save(record, sample_predictions)

    records = inf_store.list("job_test001")
    assert len(records) == 3
    # Newest first
    assert records[0].created_at > records[-1].created_at


# --- Predictions ---


def test_get_predictions(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    inf_store.save(sample_record, sample_predictions)
    result = inf_store.get_predictions(
        sample_record.job_id, sample_record.inf_id, rows=3, offset=0
    )
    assert result["total_rows"] == 5
    assert len(result["data"]) == 3
    assert "pred" in result["columns"]


def test_get_predictions_with_offset(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    inf_store.save(sample_record, sample_predictions)
    result = inf_store.get_predictions(
        sample_record.job_id, sample_record.inf_id, rows=10, offset=3
    )
    assert result["total_rows"] == 5
    assert len(result["data"]) == 2  # Only 2 remaining


def test_get_predictions_nonexistent(inf_store: InferenceStore) -> None:
    result = inf_store.get_predictions("job_x", "inf_x")
    assert result["total_rows"] == 0
    assert result["data"] == []


def test_get_predictions_df(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    inf_store.save(sample_record, sample_predictions)
    df = inf_store.get_predictions_df(sample_record.job_id, sample_record.inf_id)
    assert df is not None
    assert len(df) == 5


def test_get_predictions_df_nonexistent(inf_store: InferenceStore) -> None:
    assert inf_store.get_predictions_df("job_x", "inf_x") is None


# --- Metrics ---


def test_get_metrics(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    metrics = {"mae": 0.1, "r2": 0.9}
    inf_store.save(sample_record, sample_predictions, metrics)
    loaded = inf_store.get_metrics(sample_record.job_id, sample_record.inf_id)
    assert loaded is not None
    assert loaded["mae"] == 0.1


def test_get_metrics_no_ground_truth(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    inf_store.save(sample_record, sample_predictions, None)
    assert inf_store.get_metrics(sample_record.job_id, sample_record.inf_id) is None


# --- Comparison ---


def test_comparison_stats(
    inf_store: InferenceStore,
    sample_predictions: pd.DataFrame,
) -> None:
    job_id = "job_cmp"
    for inf_id in ("inf_a", "inf_b"):
        record = InferenceRecord(
            inf_id=inf_id,
            job_id=job_id,
            data_ref=DataRef(
                source_type="path",
                path="/data/t.csv",
                filename="t.csv",
                fingerprint="fp",
                shape=(5, 2),
            ),
            has_ground_truth=False,
            created_at="2026-01-01T00:00:00+00:00",
            row_count=5,
            warnings=[],
        )
        inf_store.save(record, sample_predictions)

    result = get_comparison_stats(inf_store, job_id, "inf_a", "inf_b")
    assert "current" in result
    assert "other" in result
    assert "mean" in result["current"]
    assert "count" in result["current"]


def test_comparison_stats_not_found(inf_store: InferenceStore) -> None:
    result = get_comparison_stats(inf_store, "job_x", "inf_a", "inf_b")
    assert "error" in result
