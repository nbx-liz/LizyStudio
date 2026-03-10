"""Tests for Inference API router endpoints."""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services.inference import InferenceRecord, InferenceStore
from lizystudio.services.jobs import JobStore


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/test.csv",
        filename="test.csv",
        fingerprint="abc",
        shape=(100, 5),
    )


def _create_inference_setup(
    client: TestClient,
    sample_data_ref: DataRef,
) -> tuple[str, str]:
    """Create a completed job and a mock inference record, return (job_id, inf_id)."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    # Create a completed job
    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "data": {"target": "y"},
            "model": {"name": "lightgbm"},
        },
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(
        metrics={"raw": {"oof": {"auc": 0.9}, "if_mean": {"auc": 0.95}}},
        fold_count=5,
        params=[],
    )
    job.model_path = "/fake/model/path"
    job_store.update(job)

    # Create a mock inference record directly via InferenceStore
    inf_store = InferenceStore(job_store.jobs_dir)
    pred_df = pd.DataFrame(
        {
            "idx": range(10),
            "pred": [0.1] * 5 + [0.9] * 5,
            "proba": [0.1] * 5 + [0.9] * 5,
        }
    )
    record = InferenceRecord(
        inf_id="inf_test001",
        job_id=job.job_id,
        data_ref=sample_data_ref,
        has_ground_truth=False,
        created_at="2026-01-01T00:00:00Z",
        row_count=10,
        warnings=[],
    )
    inf_store.save(record, pred_df)

    return job.job_id, record.inf_id


# --- History ---


def test_inference_history(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET /api/inference/history returns list with the saved record."""
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/history?job_id={job_id}")
    assert res.status_code == 200
    records = res.json()
    assert isinstance(records, list)
    assert len(records) == 1
    assert records[0]["inf_id"] == inf_id
    assert records[0]["job_id"] == job_id
    assert records[0]["row_count"] == 10


def test_inference_history_no_job_id(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET /api/inference/history without job_id returns all records."""
    _create_inference_setup(client, sample_data_ref)
    res = client.get("/api/inference/history")
    assert res.status_code == 200
    records = res.json()
    assert isinstance(records, list)
    assert len(records) >= 1


def test_inference_run_request_format(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """POST /api/inference/run accepts BLUEPRINT §5.4 body format."""
    job_id, _ = _create_inference_setup(client, sample_data_ref)
    # Should accept the nested data format — will fail at backend (no real model)
    # but should pass request validation (not 422)
    res = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "path", "path": "/nonexistent/data.csv"},
            "return_shap": False,
            "evaluate": True,
        },
    )
    # 500 is acceptable (BACKEND_ERROR due to missing model file), but not 422
    assert res.status_code != 422


def test_inference_run_old_format_rejected(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """POST /api/inference/run rejects old flat data_path format."""
    job_id, _ = _create_inference_setup(client, sample_data_ref)
    res = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data_path": "/data/test.csv",
            "return_shap": False,
        },
    )
    assert res.status_code == 422


# --- Get ---


def test_inference_get(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET /api/inference/{inf_id} returns record metadata."""
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/{inf_id}?job_id={job_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["inf_id"] == inf_id
    assert body["job_id"] == job_id
    assert body["has_ground_truth"] is False
    assert body["row_count"] == 10


def test_inference_get_not_found(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET /api/inference/nonexistent returns 404."""
    job_id, _ = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/nonexistent?job_id={job_id}")
    assert res.status_code == 404


# --- Predictions ---


def test_inference_predictions(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET /api/inference/{inf_id}/predictions returns paginated data."""
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/{inf_id}/predictions?job_id={job_id}")
    assert res.status_code == 200
    body = res.json()
    assert "columns" in body
    assert "data" in body
    assert "total_rows" in body
    assert body["total_rows"] == 10
    assert len(body["data"]) == 10
    assert "pred" in body["columns"]
    assert "proba" in body["columns"]


def test_inference_predictions_pagination(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET predictions with rows=3&offset=5 returns correct subset."""
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    res = client.get(
        f"/api/inference/{inf_id}/predictions?job_id={job_id}&rows=3&offset=5"
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total_rows"] == 10
    assert len(body["data"]) == 3
    # Rows at offset 5..7 should have pred=0.9
    for row in body["data"]:
        assert row["pred"] == 0.9


# --- Download ---


def test_inference_download(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET /api/inference/{inf_id}/download returns CSV."""
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/{inf_id}/download?job_id={job_id}")
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "attachment" in res.headers["content-disposition"]
    # Parse CSV content
    lines = res.text.strip().split("\n")
    assert len(lines) == 11  # header + 10 data rows
    header = lines[0].split(",")
    assert "pred" in header
    assert "proba" in header


# --- Comparison ---


def _create_second_inference(
    client: TestClient,
    job_id: str,
    sample_data_ref: DataRef,
) -> str:
    """Create a second inference record for comparison tests."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    inf_store = InferenceStore(job_store.jobs_dir)
    pred_df = pd.DataFrame(
        {
            "idx": range(10),
            "pred": [0.2] * 5 + [0.8] * 5,
            "proba": [0.2] * 5 + [0.8] * 5,
        }
    )
    record = InferenceRecord(
        inf_id="inf_test002",
        job_id=job_id,
        data_ref=sample_data_ref,
        has_ground_truth=False,
        created_at="2026-01-01T01:00:00Z",
        row_count=10,
        warnings=[],
    )
    inf_store.save(record, pred_df)
    return record.inf_id


def test_inference_comparison(client: TestClient, sample_data_ref: DataRef) -> None:
    """Compare two inference runs and verify stats keys."""
    job_id, inf_id_1 = _create_inference_setup(client, sample_data_ref)
    inf_id_2 = _create_second_inference(client, job_id, sample_data_ref)
    res = client.get(f"/api/inference/{inf_id_1}/comparison/{inf_id_2}?job_id={job_id}")
    assert res.status_code == 200
    body = res.json()
    assert "current" in body
    assert "other" in body
    # Verify base stat keys present
    for key in ("mean", "std", "min", "max", "count"):
        assert key in body["current"]
        assert key in body["other"]
    # Both proba columns exist, so proba stats should be present
    assert "current_proba" in body
    assert "other_proba" in body
