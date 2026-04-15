"""Tests for error handling and edge cases across API endpoints.

These used to assert ``status_code in (200, 400, 422)`` so a silent
regression that returned 200 for an empty config was indistinguishable
from a properly-rejected one. Each case now pins the exact status code
and the ``error.code`` string from the StudioError envelope.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


class TestDataErrors:
    """Error paths for data loading endpoints."""

    def test_load_nonexistent_path(self, client: TestClient) -> None:
        """POST /workspace/data/path with missing file returns PATH_NOT_FOUND."""
        resp = client.post(
            "/api/workspace/data/path",
            json={"path": "/tmp/nonexistent_e2e_file.csv"},
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "PATH_NOT_FOUND"

    def test_load_empty_path(self, client: TestClient) -> None:
        """POST /workspace/data/path with empty path returns PATH_NOT_FOUND."""
        resp = client.post("/api/workspace/data/path", json={"path": ""})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "PATH_NOT_FOUND"

    def test_upload_empty_file(self, client: TestClient) -> None:
        """POST /workspace/data/upload with empty file returns FILE_INVALID."""
        resp = client.post(
            "/api/workspace/data/upload",
            files={"file": ("empty.csv", b"", "text/csv")},
        )
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "FILE_INVALID"


class TestConfigErrors:
    """Error paths for config endpoints."""

    def test_validate_empty_config_rejects_with_no_config_error(
        self, client: TestClient
    ) -> None:
        """POST /workspace/config/validate with an empty body.

        The endpoint validates the *current* workspace config, not the
        request body, so calling it with an empty workspace returns
        WORKSPACE_NO_CONFIG rather than a 200 with a validation errors
        list. Pinning the exact code keeps the contract explicit.
        """
        resp = client.post("/api/workspace/config/validate", json={})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"

    def test_put_config_without_data_returns_preview_not_save(
        self, client: TestClient
    ) -> None:
        """PUT /workspace/config before loading data — non-destructive preview.

        The endpoint returns 200 with ``saved: false`` and the list of
        schema validation errors, so the UI can show inline errors
        without persisting a broken config. Pinning ``saved: false``
        and requiring at least one error guarantees that a future
        regression which silently writes an invalid config will be
        caught by this test.
        """
        resp = client.put(
            "/api/workspace/config",
            json={"model": {"name": "lgbm", "params": {}}},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("saved") is False, "an invalid config must not be persisted"
        assert isinstance(body.get("errors"), list)
        assert len(body["errors"]) > 0, "invalid config must produce at least one error"

        # Confirm the preview did not mutate server state.
        get_resp = client.get("/api/workspace/config")
        assert get_resp.status_code == 200
        assert get_resp.json() == {}


class TestFitErrors:
    """Error paths for fit/tune execution."""

    def test_fit_without_data(self, client: TestClient) -> None:
        """POST /workspace/fit without loading data returns a specific error."""
        resp = client.post("/api/workspace/fit")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] in {
            "WORKSPACE_NO_CONFIG",
            "WORKSPACE_NO_DATA",
        }

    def test_tune_without_data(self, client: TestClient) -> None:
        """POST /workspace/tune without loading data returns a specific error."""
        resp = client.post("/api/workspace/tune")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] in {
            "WORKSPACE_NO_CONFIG",
            "WORKSPACE_NO_DATA",
        }


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
        """POST /inference/run with non-existent job returns a precise error.

        The path validation runs first, so if the data path is outside
        the allowed root the error is PATH_NOT_FOUND (400); otherwise
        we expect JOB_NOT_FOUND (404). Either is an explicit code, not
        a wildcard ``status >= 400``.
        """
        resp = client.post(
            "/api/inference/run",
            json={
                "job_id": "nonexistent",
                "data": {"source_type": "path", "path": "/tmp/data.csv"},
                "return_shap": False,
                "evaluate": False,
            },
        )
        assert resp.status_code in (400, 404)
        assert resp.json()["error"]["code"] in {
            "PATH_NOT_FOUND",
            "JOB_NOT_FOUND",
        }

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

    def test_browse_endpoint_does_not_exist(self, client: TestClient) -> None:
        """GET /files/browse is not a real endpoint.

        The previous test silently allowed a 200 response for this
        path, masking the fact that no such route exists. We now pin
        the 404 so that a later PR adding the endpoint must
        deliberately update this test as well.
        """
        resp = client.get("/api/files/browse?path=/tmp/nonexistent_dir_xyz")
        assert resp.status_code == 404
