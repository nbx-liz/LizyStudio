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


# =============================================================================
# Additional coverage: cancel, metrics, split-summary, importance, plots, log,
# export (model/report/code-backend-error)
# =============================================================================


# --- Cancel ---


def test_cancel_running_job(client: TestClient, sample_data_ref: DataRef) -> None:
    """POST /api/jobs/{job_id}/cancel succeeds for a running job."""
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

    res = client.post(f"/api/jobs/{job.job_id}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"


def test_cancel_non_running_job_rejected(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """POST cancel on a non-running job returns 400 JOB_NOT_RUNNING."""
    job_id = _create_completed_job(client, sample_data_ref)
    res = client.post(f"/api/jobs/{job_id}/cancel")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "JOB_NOT_RUNNING"


def test_cancel_job_not_found(client: TestClient) -> None:
    """POST cancel on nonexistent job returns 404."""
    res = client.post("/api/jobs/nonexistent/cancel")
    assert res.status_code == 404


# --- Shared mock-backend helper ---


def _make_mock_backend() -> object:
    """Return a MagicMock pre-wired to behave as a BackendAdapter."""
    from unittest.mock import MagicMock

    mock = MagicMock()
    mock.load_model.return_value = MagicMock()
    return mock


# --- Metrics ---


def test_get_job_metrics(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET /api/jobs/{job_id}/metrics returns backend evaluate_table result."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.evaluate_table.return_value = [{"metric": "auc", "value": 0.95}]  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/metrics")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert data[0]["metric"] == "auc"


def test_get_job_metrics_backend_error(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET metrics propagates BackendError when the backend raises."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.evaluate_table.side_effect = RuntimeError("boom")  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/metrics")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


def test_get_job_metrics_not_completed(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET metrics on a pending job returns 400 JOB_NOT_COMPLETED."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    res = client.get(f"/api/jobs/{job.job_id}/metrics")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "JOB_NOT_COMPLETED"


# --- Split-summary ---


def test_get_job_split_summary(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET /api/jobs/{job_id}/split-summary returns backend split_summary."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.split_summary.return_value = [{"fold": 0, "auc": 0.9}]  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/split-summary")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert data[0]["fold"] == 0


def test_get_job_split_summary_backend_error(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET split-summary propagates BackendError when the backend raises."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.split_summary.side_effect = RuntimeError("split failed")  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/split-summary")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- Importance ---


def test_get_job_importance(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET /api/jobs/{job_id}/importance returns feature importance dict."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.importance.return_value = {"feat_a": 0.6, "feat_b": 0.4}  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/importance?kind=gain")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    assert res.json()["feat_a"] == 0.6
    mock_backend.importance.assert_called_once_with(  # type: ignore[union-attr]
        mock_backend.load_model.return_value,
        kind="gain",  # type: ignore[union-attr]
    )


def test_get_job_importance_backend_error(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET importance propagates BackendError when the backend raises."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.importance.side_effect = RuntimeError("no importance")  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/importance")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- Importance kinds ---


def test_get_job_importance_kinds(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET /api/jobs/{job_id}/importance-kinds returns list of valid kinds."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.importance_kinds.return_value = ["split", "gain", "shap"]  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/importance-kinds")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert "split" in data
    assert "gain" in data
    assert "shap" in data


def test_get_job_importance_kinds_backend_error(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET importance-kinds propagates BackendError when the backend raises."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.importance_kinds.side_effect = RuntimeError("no kinds")  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/importance-kinds")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- Available plots ---


def test_get_job_plots_list(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET /api/jobs/{job_id}/plots returns list of available plot types."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.available_plots.return_value = ["roc", "pr_curve"]  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/plots")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    assert "roc" in res.json()


def test_get_job_plots_list_backend_error(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET plots propagates BackendError when the backend raises."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.available_plots.side_effect = RuntimeError("no plots")  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/plots")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- Single plot ---


def test_get_job_plot(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET /api/jobs/{job_id}/plot/{type} returns plotly_json field."""
    from unittest.mock import MagicMock

    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    fake_plot = MagicMock()
    fake_plot.plotly_json = '{"data":[],"layout":{}}'
    mock_backend.plot.return_value = fake_plot  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/plot/roc")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    assert res.json()["plotly_json"] == '{"data":[],"layout":{}}'


def test_get_job_plot_backend_error(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET plot propagates BackendError when the backend raises."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    mock_backend.plot.side_effect = RuntimeError("plot failed")  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/plot/roc")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- Learning curve metrics filter (H-0034) ---


def test_get_job_plot_learning_curve_with_metrics_filter(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET /api/jobs/{id}/plot/learning-curve?metrics=auc,f1 forwards filter."""
    from unittest.mock import MagicMock

    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    fake_plot = MagicMock()
    fake_plot.plotly_json = '{"data":[],"layout":{}}'
    mock_backend.plot.return_value = fake_plot  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/plot/learning-curve?metrics=auc,f1")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    mock_backend.plot.assert_called_once_with(  # type: ignore[union-attr]
        mock_backend.plot.call_args[0][0],  # type: ignore[union-attr]
        "learning-curve",
        metrics=["auc", "f1"],
    )


def test_get_job_plot_non_learning_curve_ignores_metrics(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """GET /api/jobs/{id}/plot/roc?metrics=auc ignores metrics for non-LC."""
    from unittest.mock import MagicMock

    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    fake_plot = MagicMock()
    fake_plot.plotly_json = '{"data":[]}'
    mock_backend.plot.return_value = fake_plot  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/plot/roc?metrics=auc")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    # metrics kwarg should NOT be passed for non-learning-curve
    _, kwargs = mock_backend.plot.call_args  # type: ignore[union-attr]
    assert "metrics" not in kwargs


# --- Log with content ---


def test_get_job_log_with_content(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET /api/jobs/{job_id}/log returns written log content."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    log_path = job_store.jobs_dir / job.job_id / "execution.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text("Training started\nEpoch 1 done\n", encoding="utf-8")

    res = client.get(f"/api/jobs/{job.job_id}/log")
    assert res.status_code == 200
    assert "Training started" in res.json()["log"]


# --- Export model / report ---


def test_export_job_model(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path: Path,
) -> None:
    """POST /api/jobs/{job_id}/export with export_type=model calls export_model."""
    from unittest.mock import patch

    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    output_path = str(tmp_path / "out" / "model_export")

    with patch(
        "lizystudio.api.jobs.export_model", return_value=output_path
    ) as mock_export:
        res = client.post(
            f"/api/jobs/{job_id}/export",
            json={"export_type": "model", "output_path": output_path},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["export_type"] == "model"
    assert body["exported_path"] == output_path
    mock_export.assert_called_once()


def test_export_job_report(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path: Path,
) -> None:
    """POST /api/jobs/{job_id}/export with export_type=report calls export_report."""
    from unittest.mock import patch

    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    output_path = str(tmp_path / "out" / "report_export")

    with patch(
        "lizystudio.api.jobs.export_report", return_value=output_path
    ) as mock_export:
        res = client.post(
            f"/api/jobs/{job_id}/export",
            json={"export_type": "report", "output_path": output_path},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["export_type"] == "report"
    mock_export.assert_called_once()


def test_export_job_not_completed(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """POST export on a pending job returns 400 JOB_NOT_COMPLETED."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    output_path = str(tmp_path / "out")
    res = client.post(
        f"/api/jobs/{job.job_id}/export",
        json={"export_type": "model", "output_path": output_path},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "JOB_NOT_COMPLETED"


def test_export_job_backend_error(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path: Path,
) -> None:
    """POST export propagates BackendError when the backend call raises."""
    from unittest.mock import patch

    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    output_path = str(tmp_path / "out" / "model_export")

    with patch(
        "lizystudio.api.jobs.export_model", side_effect=RuntimeError("export failed")
    ):
        res = client.post(
            f"/api/jobs/{job_id}/export",
            json={"export_type": "model", "output_path": output_path},
        )

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "EXPORT_ERROR"


def test_job_config_snapshot_isolation(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Job config is an isolated snapshot; post-creation mutations don't affect it."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    original_config = {
        "task": "binary",
        "model": {"name": "lgbm", "params": {"lr": 0.1}},
    }
    job = job_store.create(
        backend_name="lizyml",
        config=original_config,
        data_ref=sample_data_ref,
        job_type="fit",
    )

    # Mutate the original dict after job creation
    original_config["model"]["params"]["lr"] = 999
    original_config["task"] = "regression"

    # Reload from disk and verify isolation
    loaded = job_store.get(job.job_id)
    assert loaded is not None
    assert loaded.config["task"] == "binary"
    assert loaded.config["model"]["params"]["lr"] == 0.1


def test_export_code_backend_error(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """POST export-code propagates BackendError when export_code_as_zip raises."""
    from unittest.mock import patch

    model_dir = str(tmp_path / "model")
    job_id = _create_completed_job_with_model(client, sample_data_ref, model_dir)

    with patch(
        "lizystudio.api.jobs.export_code_as_zip",
        side_effect=RuntimeError("zip failed"),
    ):
        res = client.post(f"/api/jobs/{job_id}/export-code")

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# ---------------------------------------------------------------------------
# Metric name / kind injection prevention (#18)
# ---------------------------------------------------------------------------


def test_plot_rejects_invalid_metric_name(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """Invalid metric names in learning-curve query are rejected."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    for bad in ("../../etc", "<script>alert(1)</script>", "a;DROP"):
        res = client.get(f"/api/jobs/{job_id}/plot/learning-curve?metrics={bad}")
        assert res.status_code == 400, f"Expected 400 for {bad!r}"
        assert res.json()["error"]["code"] == "INVALID_PARAM"


def test_plot_accepts_valid_metric_name(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """Valid metric names pass validation (backend may still error)."""
    from unittest.mock import MagicMock

    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    mock_backend = _make_mock_backend()
    fake_plot = MagicMock()
    fake_plot.plotly_json = '{"data":[]}'
    mock_backend.plot.return_value = fake_plot  # type: ignore[union-attr]

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/jobs/{job_id}/plot/learning-curve?metrics=auc,rmse")
    finally:
        app.state.workspace.backend = original
    assert res.status_code == 200


def test_importance_rejects_invalid_kind(
    client: TestClient, sample_data_ref: DataRef, tmp_path: Path
) -> None:
    """Invalid kind parameter in importance is rejected."""
    job_id = _create_completed_job_with_model(
        client, sample_data_ref, str(tmp_path / "model")
    )
    res = client.get(f"/api/jobs/{job_id}/plot/importance?kind=../escape")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_PARAM"
