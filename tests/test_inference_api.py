"""Tests for Inference API router endpoints."""

from __future__ import annotations

import io

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


def test_inference_predictions_not_found(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET predictions for nonexistent inf_id returns 404."""
    job_id, _ = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/nonexistent_inf/predictions?job_id={job_id}")
    assert res.status_code == 404


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


def test_inference_download_not_found(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET download for nonexistent inf_id returns 404."""
    job_id, _ = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/nonexistent_inf/download?job_id={job_id}")
    assert res.status_code == 404


# --- Metrics ---


def test_inference_metrics_no_ground_truth(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET /api/inference/{inf_id}/metrics returns 404 when no ground truth."""
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    # The default record has has_ground_truth=False, so no metrics.json was saved
    res = client.get(f"/api/inference/{inf_id}/metrics?job_id={job_id}")
    assert res.status_code == 404


def test_inference_metrics_with_ground_truth(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET /api/inference/{inf_id}/metrics returns metrics when ground truth present."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job_id, _ = _create_inference_setup(client, sample_data_ref)

    inf_store = InferenceStore(job_store.jobs_dir)
    pred_df = pd.DataFrame(
        {"pred": [0.0, 1.0, 0.0, 1.0], "proba": [0.1, 0.9, 0.2, 0.8]}
    )
    metrics_data = {"accuracy": 1.0, "auc": 0.99}
    record = InferenceRecord(
        inf_id="inf_with_gt",
        job_id=job_id,
        data_ref=sample_data_ref,
        has_ground_truth=True,
        created_at="2026-01-02T00:00:00Z",
        row_count=4,
        warnings=[],
    )
    inf_store.save(record, pred_df, metrics_data)

    res = client.get(f"/api/inference/{record.inf_id}/metrics?job_id={job_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["accuracy"] == 1.0
    assert body["auc"] == 0.99


def test_inference_metrics_not_found(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET metrics for nonexistent inf_id returns 404."""
    job_id, _ = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/nonexistent_inf/metrics?job_id={job_id}")
    assert res.status_code == 404


# --- Plot ---


def test_inference_plot_success(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET /api/inference/{inf_id}/plot/{type} returns plotly_json via mock backend."""
    from unittest.mock import MagicMock

    job_id, inf_id = _create_inference_setup(client, sample_data_ref)

    fake_plot = MagicMock()
    fake_plot.plotly_json = '{"data":[],"layout":{}}'

    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.plot.return_value = fake_plot

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/inference/{inf_id}/plot/roc?job_id={job_id}")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    assert res.json()["plotly_json"] == '{"data":[],"layout":{}}'


def test_inference_plot_not_found(client: TestClient, sample_data_ref: DataRef) -> None:
    """GET plot for nonexistent inf_id returns 404."""
    job_id, _ = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/nonexistent_inf/plot/roc?job_id={job_id}")
    assert res.status_code == 404


def test_inference_plot_backend_error(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET plot propagates BackendError when backend.plot raises."""
    from unittest.mock import MagicMock

    job_id, inf_id = _create_inference_setup(client, sample_data_ref)

    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.plot.side_effect = RuntimeError("plot failed")

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/inference/{inf_id}/plot/roc?job_id={job_id}")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- Run success (mocked backend) ---


def test_inference_run_success(
    client: TestClient, sample_data_ref: DataRef, tmp_path: object
) -> None:
    """POST /api/inference/run succeeds when backend and data are mocked."""
    from pathlib import Path
    from unittest.mock import MagicMock

    import pandas as pd

    job_id, _ = _create_inference_setup(client, sample_data_ref)

    # Write a real CSV file so the path is valid
    data_csv = Path("/tmp") / "lizystudio_test_infer_data.csv"
    pd.DataFrame({"feature1": [1, 2, 3], "feature2": [4, 5, 6]}).to_csv(
        data_csv, index=False
    )

    fake_pred_result = MagicMock()
    fake_pred_result.predictions = pd.DataFrame(
        {"pred": [0, 1, 0], "proba": [0.1, 0.9, 0.2]}
    )
    fake_pred_result.warnings = []

    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.model_info.return_value = {"target": None, "task": "binary"}
    mock_backend.predict.return_value = fake_pred_result

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.post(
            "/api/inference/run",
            json={
                "job_id": job_id,
                "data": {"source_type": "path", "path": str(data_csv)},
                "return_shap": False,
                "evaluate": False,
            },
        )
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 200
    body = res.json()
    assert "inf_id" in body
    assert body["job_id"] == job_id


def test_inference_run_job_not_completed(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """POST /api/inference/run returns 400 when job is still pending."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    # Stays pending

    res = client.post(
        "/api/inference/run",
        json={
            "job_id": job.job_id,
            "data": {"source_type": "path", "path": "/tmp/data.csv"},
            "return_shap": False,
            "evaluate": False,
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "JOB_NOT_COMPLETED"


# --- Upload ---


def test_inference_upload_csv(client: TestClient) -> None:
    """POST /api/inference/upload returns upload_path for a CSV file."""
    csv_content = b"col1,col2\n1,2\n3,4\n"
    res = client.post(
        "/api/inference/upload",
        files={"file": ("data.csv", io.BytesIO(csv_content), "text/csv")},
    )
    assert res.status_code == 200
    body = res.json()
    assert "upload_path" in body
    assert body["upload_path"].endswith(".csv")
    assert body["filename"] == "data.csv"


def test_inference_upload_parquet(client: TestClient) -> None:
    """POST /api/inference/upload accepts .parquet extension."""
    import pandas as pd

    buf = io.BytesIO()
    pd.DataFrame({"a": [1, 2], "b": [3, 4]}).to_parquet(buf, index=False)
    buf.seek(0)

    res = client.post(
        "/api/inference/upload",
        files={
            "file": (
                "data.parquet",
                buf,
                "application/octet-stream",
            )
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["upload_path"].endswith(".parquet")
    assert body["filename"] == "data.parquet"


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


def test_inference_comparison_not_found(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Comparison with a missing inference returns 404."""
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    res = client.get(f"/api/inference/{inf_id}/comparison/nonexistent?job_id={job_id}")
    assert res.status_code == 404


# --- Run with nonexistent job_id ---


def test_inference_run_job_not_found(client: TestClient) -> None:
    """POST /api/inference/run returns 404 when the job does not exist."""
    res = client.post(
        "/api/inference/run",
        json={
            "job_id": "nonexistent_job",
            "data": {"source_type": "path", "path": "/tmp/data.csv"},
            "return_shap": False,
            "evaluate": False,
        },
    )
    assert res.status_code == 404


# --- Run BackendError path ---


def test_inference_run_backend_error(
    client: TestClient, sample_data_ref: DataRef, tmp_path: object
) -> None:
    """POST /api/inference/run returns 500 BackendError when backend raises."""
    from pathlib import Path
    from unittest.mock import MagicMock

    import pandas as pd

    job_id, _ = _create_inference_setup(client, sample_data_ref)

    data_csv = Path("/tmp") / "lizystudio_test_be_err.csv"
    pd.DataFrame({"x": [1, 2]}).to_csv(data_csv, index=False)

    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.model_info.return_value = {"target": None, "task": "binary"}
    mock_backend.predict.side_effect = RuntimeError("backend exploded")

    app = client.app  # type: ignore[union-attr]
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.post(
            "/api/inference/run",
            json={
                "job_id": job_id,
                "data": {"source_type": "path", "path": str(data_csv)},
                "return_shap": False,
                "evaluate": False,
            },
        )
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- Upload FileInvalidError path ---


def test_inference_upload_oversized_file(client: TestClient) -> None:
    """POST /api/inference/upload returns 400 when file exceeds size limit."""
    from unittest.mock import AsyncMock, patch

    with patch(
        "lizystudio.api.inference.read_upload_checked",
        new_callable=AsyncMock,
        side_effect=ValueError("File too large"),
    ):
        res = client.post(
            "/api/inference/upload",
            files={"file": ("big.csv", b"x" * 10, "text/csv")},
        )

    assert res.status_code == 400
    assert res.json()["error"]["code"] == "FILE_INVALID"


# --- Plot when job has no model_path ---


def test_inference_plot_no_model_path(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """GET plot returns 404 when parent job has no model_path."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)

    # Clear model_path from the job
    job = job_store.get(job_id)
    assert job is not None
    job.model_path = None
    job_store.update(job)

    res = client.get(f"/api/inference/{inf_id}/plot/roc?job_id={job_id}")
    assert res.status_code == 404
