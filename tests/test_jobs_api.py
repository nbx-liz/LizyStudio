"""Tests for Jobs API router endpoints."""

from __future__ import annotations

from pathlib import Path

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


def test_delete_running_job_rejected(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """DELETE on a running job must return 400 with JOB_RUNNING error (v2-13)."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "running"
    job_store.update(job)

    res = client.delete(f"/api/jobs/{job.job_id}")
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "JOB_RUNNING"


# --- Trailing slash ---


def test_jobs_list_no_trailing_slash(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET /api/jobs (no trailing slash) must return JSON, not SPA HTML."""
    _create_completed_job(client, sample_data_ref)
    res = client.get("/api/jobs", follow_redirects=True)
    assert res.status_code == 200
    jobs = res.json()
    assert isinstance(jobs, list)
    assert len(jobs) == 1


# --- Log ---


def test_get_job_log_empty(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET /api/jobs/{job_id}/log returns empty log for a job without execution log."""
    job_id = _create_completed_job(client, sample_data_ref)
    res = client.get(f"/api/jobs/{job_id}/log")
    assert res.status_code == 200
    body = res.json()
    assert "log" in body
    assert body["log"] == ""


def test_get_job_log_not_found(client: TestClient) -> None:
    """GET /api/jobs/nonexistent/log returns 404."""
    res = client.get("/api/jobs/nonexistent/log")
    assert res.status_code == 404


# --- Summary fields ---


def test_job_summary_includes_model_name(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Job list response includes model_name from config.model.name."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "model": {"name": "lightgbm"}},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(metrics={"auc": 0.9}, fold_count=5, params=[])
    job_store.update(job)

    res = client.get("/api/jobs/")
    assert res.status_code == 200
    jobs = res.json()
    matching = [j for j in jobs if j["job_id"] == job.job_id]
    assert len(matching) == 1
    assert matching[0]["model_name"] == "lightgbm"


def test_job_summary_includes_primary_score(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Job list response includes primary_score from fit_result raw.oof metrics."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "model": {"name": "lightgbm"}},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(
        metrics={"raw": {"oof": {"auc": 0.92}, "if_mean": {"auc": 0.97}}},
        fold_count=5,
        params=[],
    )
    job_store.update(job)

    res = client.get("/api/jobs/")
    assert res.status_code == 200
    jobs = res.json()
    matching = [j for j in jobs if j["job_id"] == job.job_id]
    assert len(matching) == 1
    assert matching[0]["primary_score"] == 0.92


# --- Export Code ---


def _create_completed_job_with_model(
    client: TestClient, sample_data_ref: DataRef, tmp_model_path: str
) -> str:
    """Create a completed job that has a model_path set."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "target": "y"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.model_path = tmp_model_path
    job.fit_result = FitSummary(
        metrics={"auc": 0.95},
        fold_count=5,
        params=[],
    )
    job_store.update(job)
    return job.job_id


def test_export_code_returns_zip(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path: Path,
) -> None:
    """POST /api/jobs/{job_id}/export-code returns a ZIP file for a completed job."""
    from pathlib import Path
    from unittest.mock import MagicMock

    # Create a real temp directory for the fake model
    model_dir = str(tmp_path / "model")
    job_id = _create_completed_job_with_model(client, sample_data_ref, model_dir)

    def fake_export_code(model: object, path: str) -> str:
        code_dir = Path(path)
        code_dir.mkdir(parents=True, exist_ok=True)
        (code_dir / "train.py").write_text("# train")
        return str(code_dir)

    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.export_code.side_effect = fake_export_code

    app = client.app  # type: ignore[union-attr]
    original_backend = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.post(f"/api/jobs/{job_id}/export-code")
    finally:
        app.state.workspace.backend = original_backend

    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    assert "zip" in res.headers.get("content-disposition", "").lower()


def test_export_code_not_found(client: TestClient) -> None:
    """POST /api/jobs/nonexistent/export-code returns 404."""
    res = client.post("/api/jobs/nonexistent/export-code")
    assert res.status_code == 404


def test_export_code_job_not_completed(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """POST /api/jobs/{job_id}/export-code returns 400 when job is not completed."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    # Job remains in pending status — no model_path
    res = client.post(f"/api/jobs/{job.job_id}/export-code")
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "JOB_NOT_COMPLETED"


def test_export_code_no_model_path(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """POST /api/jobs/{job_id}/export-code returns 400 when job has no model_path."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(metrics={"auc": 0.9}, fold_count=5, params=[])
    # Intentionally NOT setting model_path
    job_store.update(job)

    res = client.post(f"/api/jobs/{job.job_id}/export-code")
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "JOB_NOT_COMPLETED"
