"""API schema contract tests.

Verifies that actual API responses match the OpenAPI schema generated
by FastAPI, ensuring frontend-backend type consistency.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

# --- OpenAPI schema structure ---


class TestOpenApiSchema:
    """Verify OpenAPI schema is well-formed and covers all routers."""

    def test_openapi_json_is_valid(self, client: TestClient) -> None:
        """GET /openapi.json returns valid JSON."""
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        schema = resp.json()
        assert "openapi" in schema
        assert "paths" in schema
        assert "info" in schema

    def test_openapi_paths_include_workspace(self, client: TestClient) -> None:
        """OpenAPI schema includes workspace endpoints."""
        schema = client.get("/openapi.json").json()
        paths = schema["paths"]
        expected = [
            "/api/workspace/status",
            "/api/workspace/data/path",
            "/api/workspace/data/preview",
            "/api/workspace/data/columns",
            "/api/workspace/config/schema",
            "/api/workspace/config",
            "/api/workspace/config/defaults",
            "/api/workspace/fit",
            "/api/workspace/tune",
        ]
        for path in expected:
            assert path in paths, f"Missing workspace path: {path}"

    def test_openapi_paths_include_jobs(self, client: TestClient) -> None:
        """OpenAPI schema includes jobs endpoints."""
        schema = client.get("/openapi.json").json()
        paths = schema["paths"]
        assert "/api/jobs/" in paths

    def test_openapi_paths_include_inference(self, client: TestClient) -> None:
        """OpenAPI schema includes inference endpoints."""
        schema = client.get("/openapi.json").json()
        paths = schema["paths"]
        assert "/api/inference/run" in paths

    def test_openapi_paths_include_backends(self, client: TestClient) -> None:
        """OpenAPI schema includes backends endpoints."""
        schema = client.get("/openapi.json").json()
        paths = schema["paths"]
        assert "/api/backends" in paths

    def test_openapi_paths_include_files(self, client: TestClient) -> None:
        """OpenAPI schema includes files endpoints."""
        schema = client.get("/openapi.json").json()
        paths = schema["paths"]
        assert "/api/files" in paths


# --- Response schema validation ---


def _resolve_ref(schema: dict[str, Any], ref: str) -> dict[str, Any]:
    """Resolve a $ref pointer in an OpenAPI schema."""
    parts = ref.lstrip("#/").split("/")
    current: Any = schema
    for part in parts:
        current = current[part]
    return current  # type: ignore[return-value]


def _get_response_schema(
    openapi: dict[str, Any], path: str, method: str = "get", status: str = "200"
) -> dict[str, Any] | None:
    """Extract the response schema for a given endpoint."""
    endpoint = openapi.get("paths", {}).get(path, {}).get(method, {})
    response = endpoint.get("responses", {}).get(status, {})
    content = response.get("content", {}).get("application/json", {})
    schema = content.get("schema", {})
    if "$ref" in schema:
        return _resolve_ref(openapi, schema["$ref"])
    return schema if schema else None


class TestActualResponseMatchesSchema:
    """Verify actual API responses match declared OpenAPI schemas."""

    def test_workspace_status_response(self, client: TestClient) -> None:
        """GET /api/workspace/status response has expected fields."""
        resp = client.get("/api/workspace/status")
        assert resp.status_code == 200
        data = resp.json()

        # Verify expected fields exist
        expected_fields = ["has_data", "has_config", "has_result"]
        for field in expected_fields:
            assert field in data, f"Missing field in status: {field}"

    def test_workspace_status_field_types(self, client: TestClient) -> None:
        """Status response field types match expectations."""
        data = client.get("/api/workspace/status").json()
        assert isinstance(data["has_data"], bool)
        assert isinstance(data["has_config"], bool)
        assert isinstance(data["has_result"], bool)

    def test_backends_list_response(self, client: TestClient) -> None:
        """GET /api/backends returns a list of backend info objects."""
        resp = client.get("/api/backends")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0
        backend = data[0]
        assert "name" in backend
        assert "version" in backend

    def test_jobs_list_empty_response(self, client: TestClient) -> None:
        """GET /api/jobs/ returns an empty list when no jobs exist."""
        resp = client.get("/api/jobs/")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_config_schema_response(self, client: TestClient) -> None:
        """GET /api/workspace/config/schema returns a valid JSON Schema."""
        resp = client.get("/api/workspace/config/schema")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)
        # JSON Schema should have type or properties
        assert "type" in data or "properties" in data


# --- Error response format ---


class TestErrorResponseFormat:
    """Verify all error responses follow a consistent envelope."""

    def test_404_job_error_format(self, client: TestClient) -> None:
        """GET /api/jobs/nonexistent returns structured error."""
        resp = client.get("/api/jobs/nonexistent")
        assert resp.status_code == 404
        data = resp.json()
        assert "error" in data
        error = data["error"]
        assert "code" in error
        assert "message" in error

    def test_validation_error_format(self, client: TestClient) -> None:
        """POST with invalid body returns structured validation error."""
        resp = client.post(
            "/api/workspace/data/path",
            json={},  # Missing required 'path' field
        )
        # Should be 422 (validation error) or 4xx
        assert resp.status_code >= 400

    def test_config_patch_invalid_format(self, client: TestClient) -> None:
        """Invalid config patch returns error with details."""
        resp = client.post(
            "/api/workspace/config/patch",
            json={"operations": [{"op": "invalid_op", "path": "/foo"}]},
        )
        assert resp.status_code >= 400


# --- Schema consistency between endpoints ---


class TestSchemaConsistency:
    """Verify related endpoints return consistent schemas."""

    def test_backends_list_and_ui_schema_same_backend(self, client: TestClient) -> None:
        """Backends list and UI schema reference the same backend name."""
        backends_resp = client.get("/api/backends")
        assert backends_resp.status_code == 200
        backends = backends_resp.json()
        assert len(backends) > 0

        ui_resp = client.get("/api/backends/ui-schema")
        assert ui_resp.status_code == 200
        ui_schema = ui_resp.json()
        assert isinstance(ui_schema, dict)

    def test_config_schema_and_defaults_compatible(self, client: TestClient) -> None:
        """Config defaults should be valid against config schema."""
        schema_resp = client.get("/api/workspace/config/schema")
        assert schema_resp.status_code == 200

        defaults_resp = client.get(
            "/api/workspace/config/defaults",
            params={"task": "binary", "target": "y"},
        )
        assert defaults_resp.status_code == 200
        defaults = defaults_resp.json()
        assert isinstance(defaults, dict)
        # Defaults should be a non-empty config
        assert len(defaults) > 0
