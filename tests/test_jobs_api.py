"""Tests for Jobs API router endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.services.jobs import JobStore


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )


def _create_completed_job(client: TestClient, sample_data_ref: DataRef) -> str:
    """Create a completed job with fit result via the store directly."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "target": "y"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(
        metrics={"auc": 0.95, "logloss": 0.12},
        fold_count=5,
        params=[{"n_estimators": 100}],
    )
    job_store.update(job)
    return job.job_id


# --- List / Get ---


def test_jobs_list_with_jobs(client: TestClient, sample_data_ref: DataRef) -> None:
    job_id = _create_completed_job(client, sample_data_ref)
    res = client.get("/api/jobs/")
    assert res.status_code == 200
    jobs = res.json()
    assert len(jobs) == 1
    assert jobs[0]["job_id"] == job_id
    assert jobs[0]["status"] == "completed"


def test_jobs_list_filter_status(client: TestClient, sample_data_ref: DataRef) -> None:
    _create_completed_job(client, sample_data_ref)
    # Create a pending job
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    # Filter by completed
    res = client.get("/api/jobs/?status=completed")
    assert res.status_code == 200
    assert len(res.json()) == 1

    # Filter by pending
    res = client.get("/api/jobs/?status=pending")
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_get_job_with_fit_result(client: TestClient, sample_data_ref: DataRef) -> None:
    job_id = _create_completed_job(client, sample_data_ref)
    res = client.get(f"/api/jobs/{job_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "completed"
    assert body["fit_result"]["metrics"]["auc"] == 0.95
    assert body["fit_result"]["fold_count"] == 5


def test_get_job_with_tune_result(client: TestClient, sample_data_ref: DataRef) -> None:
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.status = "completed"
    job.tune_result = TuningSummary(
        best_params={"lr": 0.01},
        best_score=0.98,
        trials=[{"number": 1, "score": 0.98, "params": {"lr": 0.01}}],
        metric_name="auc",
        direction="maximize",
    )
    job.fit_result = FitSummary(
        metrics={"auc": 0.98}, fold_count=5, params=[{"lr": 0.01}]
    )
    job_store.update(job)

    res = client.get(f"/api/jobs/{job.job_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["tune_result"]["best_score"] == 0.98
    assert body["fit_result"]["metrics"]["auc"] == 0.98


# --- Config ---


def test_get_job_config(client: TestClient, sample_data_ref: DataRef) -> None:
    job_id = _create_completed_job(client, sample_data_ref)
    res = client.get(f"/api/jobs/{job_id}/config")
    assert res.status_code == 200
    assert res.json()["task"] == "binary"


# --- Delete ---


def test_delete_job(client: TestClient, sample_data_ref: DataRef) -> None:
    job_id = _create_completed_job(client, sample_data_ref)
    res = client.delete(f"/api/jobs/{job_id}")
    assert res.status_code == 200
    assert res.json()["status"] == "deleted"
    # Verify deleted
    res = client.get(f"/api/jobs/{job_id}")
    assert res.status_code == 404


def test_delete_job_not_found(client: TestClient) -> None:
    res = client.delete("/api/jobs/nonexistent")
    assert res.status_code == 404
