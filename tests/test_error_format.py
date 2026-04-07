"""Tests for standardized error response format (H-0007, BLUEPRINT §6.1)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_422_returns_standard_error_envelope(client: TestClient) -> None:
    """POST with invalid body returns standard error format, not Pydantic default."""
    res = client.post("/api/inference/run", json={"bad_field": True})
    assert res.status_code == 422
    body = res.json()
    assert "error" in body
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["message"] == "Request validation failed"
    assert "errors" in body["error"]["details"]


def test_404_returns_standard_error_envelope(client: TestClient) -> None:
    """GET non-existent job returns standard error format."""
    res = client.get("/api/jobs/nonexistent")
    assert res.status_code == 404
    body = res.json()
    assert "error" in body
    assert body["error"]["code"] == "JOB_NOT_FOUND"
