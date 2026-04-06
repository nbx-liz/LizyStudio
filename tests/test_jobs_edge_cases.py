"""Edge case tests for jobs API: error sanitization, metrics validation."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef, FitSummary
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


def _create_completed_job_with_model(
    client: TestClient, sample_data_ref: DataRef, model_path: str
) -> str:
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "target": "y", "model": {"name": "lgbm"}},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.model_path = model_path
    job.fit_result = FitSummary(metrics={"auc": 0.95}, fold_count=5, params=[])
    job_store.update(job)
    return job.job_id


# ---------------------------------------------------------------------------
# _sanitize_error — multiline error messages
# ---------------------------------------------------------------------------


def test_job_summary_error_sanitized() -> None:
    """_sanitize_error should keep only the first line of error messages."""
    from lizystudio.api.jobs import _sanitize_error

    multiline = "ValueError: bad config\n  File 'foo.py', line 42\n  traceback..."
    result = _sanitize_error(multiline)
    assert result == "ValueError: bad config"
    assert "\n" not in result


def test_sanitize_error_none() -> None:
    """_sanitize_error returns None for None input."""
    from lizystudio.api.jobs import _sanitize_error

    assert _sanitize_error(None) is None


def test_sanitize_error_empty() -> None:
    """_sanitize_error returns empty string for empty input."""
    from lizystudio.api.jobs import _sanitize_error

    assert _sanitize_error("") == ""


def test_sanitize_error_single_line() -> None:
    """_sanitize_error keeps single-line errors as-is."""
    from lizystudio.api.jobs import _sanitize_error

    assert _sanitize_error("RuntimeError: boom") == "RuntimeError: boom"


def test_job_list_shows_sanitized_error(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Job list response should show sanitized (single-line) error."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "failed"
    job.error = "ValueError: bad\nTraceback (most recent call last):\n  File..."
    job_store.update(job)

    res = client.get("/api/jobs/")
    assert res.status_code == 200
    jobs = res.json()
    failed = [j for j in jobs if j["job_id"] == job.job_id]
    assert len(failed) == 1
    assert failed[0]["error"] == "ValueError: bad"
    assert "\n" not in (failed[0]["error"] or "")


# ---------------------------------------------------------------------------
# Plot metrics validation
# ---------------------------------------------------------------------------


def test_plot_too_many_metrics(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET plot/learning-curve with >20 metrics returns INVALID_PARAM."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    metrics = ",".join([f"metric_{i}" for i in range(25)])
    res = client.get(f"/api/jobs/{job_id}/plot/learning-curve?metrics={metrics}")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_PARAM"


def test_plot_invalid_metric_names(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET plot/learning-curve with invalid metric names returns INVALID_PARAM."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    res = client.get(
        f"/api/jobs/{job_id}/plot/learning-curve?metrics=valid_metric,bad-metric!"
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_PARAM"


def test_plot_valid_metric_names_pass_validation(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET plot/learning-curve with valid metric names passes validation."""
    from unittest.mock import MagicMock

    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    fake_plot = MagicMock()
    fake_plot.plotly_json = '{"data":[]}'
    mock_backend.plot.return_value = fake_plot

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/plot/learning-curve?metrics=auc,f1_score")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200


# ---------------------------------------------------------------------------
# Delete race condition
# ---------------------------------------------------------------------------


def test_delete_job_store_returns_false(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """DELETE when job_store.delete() returns False → 404."""
    from unittest.mock import patch

    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job_store.update(job)

    # Simulate race: get() finds the job, but delete() fails
    with patch.object(job_store, "delete", return_value=False):
        res = client.delete(f"/api/jobs/{job.job_id}")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Job summary — primary_score edge cases
# ---------------------------------------------------------------------------


def test_job_summary_no_raw_metrics(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Job summary handles missing raw.oof metrics gracefully."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    # metrics without 'raw' key
    job.fit_result = FitSummary(metrics={"auc": 0.9}, fold_count=5, params=[])
    job_store.update(job)

    res = client.get("/api/jobs/")
    jobs = res.json()
    matching = [j for j in jobs if j["job_id"] == job.job_id]
    assert matching[0]["primary_score"] is None


def test_job_summary_empty_oof(client: TestClient, sample_data_ref: DataRef) -> None:
    """Job summary handles empty oof dict."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(metrics={"raw": {"oof": {}}}, fold_count=5, params=[])
    job_store.update(job)

    res = client.get("/api/jobs/")
    jobs = res.json()
    matching = [j for j in jobs if j["job_id"] == job.job_id]
    assert matching[0]["primary_score"] is None
