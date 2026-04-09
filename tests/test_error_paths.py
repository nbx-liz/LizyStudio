"""Tests for error handling and edge cases across API endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


class TestDataErrors:
    """Error paths for data loading endpoints."""

    def test_load_nonexistent_path(self, client: TestClient) -> None:
        """POST /workspace/data/path with missing file returns error."""
        resp = client.post(
            "/api/workspace/data/path",
            json={"path": "/tmp/nonexistent_e2e_file.csv"},
        )
        assert resp.status_code >= 400

    def test_load_empty_path(self, client: TestClient) -> None:
        """POST /workspace/data/path with empty path returns error."""
        resp = client.post("/api/workspace/data/path", json={"path": ""})
        assert resp.status_code >= 400

    def test_upload_empty_file(self, client: TestClient) -> None:
        """POST /workspace/data/upload with empty file returns error."""
        resp = client.post(
            "/api/workspace/data/upload",
            files={"file": ("empty.csv", b"", "text/csv")},
        )
        assert resp.status_code >= 400


class TestConfigErrors:
    """Error paths for config endpoints."""

    def test_validate_empty_config(self, client: TestClient) -> None:
        """POST /workspace/config/validate with empty config."""
        resp = client.post("/api/workspace/config/validate", json={})
        # Should return 200 with errors list, or 400/422
        assert resp.status_code in (200, 400, 422)

    def test_put_config_without_data(self, client: TestClient) -> None:
        """PUT /workspace/config before loading data."""
        resp = client.put(
            "/api/workspace/config",
            json={"model": {"name": "lgbm", "params": {}}},
        )
        # Backend may accept config before data or return error
        assert resp.status_code in (200, 400)


class TestFitErrors:
    """Error paths for fit/tune execution."""

    def test_fit_without_data(self, client: TestClient) -> None:
        """POST /workspace/fit without loading data returns error."""
        resp = client.post("/api/workspace/fit")
        assert resp.status_code >= 400

    def test_tune_without_data(self, client: TestClient) -> None:
        """POST /workspace/tune without loading data returns error."""
        resp = client.post("/api/workspace/tune")
        assert resp.status_code >= 400


class TestJobErrors:
    """Error paths for job endpoints."""

    def test_get_nonexistent_job(self, client: TestClient) -> None:
        """GET /jobs/{non_existent_id} returns 404."""
        resp = client.get("/api/jobs/non-existent-job-id")
        assert resp.status_code == 404

    def test_delete_nonexistent_job(self, client: TestClient) -> None:
        """DELETE /jobs/{non_existent_id} returns 404."""
        resp = client.delete("/api/jobs/non-existent-job-id")
        assert resp.status_code == 404

    def test_cancel_nonexistent_job(self, client: TestClient) -> None:
        """POST /jobs/{non_existent_id}/cancel returns 404."""
        resp = client.post("/api/jobs/non-existent-job-id/cancel")
        assert resp.status_code == 404

    def test_export_nonexistent_job(self, client: TestClient) -> None:
        """POST /jobs/{non_existent_id}/export returns 404."""
        resp = client.post(
            "/api/jobs/non-existent-job-id/export",
            json={"export_type": "model", "output_path": "/tmp/out.pkl"},
        )
        assert resp.status_code == 404

    def test_get_log_nonexistent_job(self, client: TestClient) -> None:
        """GET /jobs/{non_existent_id}/log returns 404."""
        resp = client.get("/api/jobs/non-existent-job-id/log")
        assert resp.status_code == 404

    def test_get_config_nonexistent_job(self, client: TestClient) -> None:
        """GET /jobs/{non_existent_id}/config returns 404."""
        resp = client.get("/api/jobs/non-existent-job-id/config")
        assert resp.status_code == 404


class TestInferenceErrors:
    """Error paths for inference endpoints."""

    def test_inference_nonexistent_job(self, client: TestClient) -> None:
        """POST /inference/run with non-existent job returns error."""
        resp = client.post(
            "/api/inference/run",
            json={
                "job_id": "nonexistent",
                "data": {"source_type": "path", "path": "/tmp/data.csv"},
                "return_shap": False,
                "evaluate": False,
            },
        )
        assert resp.status_code >= 400

    def test_inference_record_nonexistent(self, client: TestClient) -> None:
        """GET /inference/{non_existent_id} returns 404."""
        resp = client.get(
            "/api/inference/nonexistent?job_id=nonexistent",
        )
        assert resp.status_code == 404

    def test_inference_predictions_nonexistent(self, client: TestClient) -> None:
        """GET /inference/{id}/predictions for missing record returns 404."""
        resp = client.get(
            "/api/inference/nonexistent/predictions?job_id=nonexistent",
        )
        assert resp.status_code == 404


class TestFileErrors:
    """Error paths for file browsing."""

    def test_browse_nonexistent_path(self, client: TestClient) -> None:
        """GET /files/browse with non-existent directory."""
        resp = client.get("/api/files/browse?path=/tmp/nonexistent_dir_xyz")
        # Either returns empty list or 404
        assert resp.status_code in (200, 404)
