"""Smoke tests for the FastAPI application."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_workspace_status(client: TestClient) -> None:
    res = client.get("/api/workspace/status")
    assert res.status_code == 200
    body = res.json()
    assert body["has_data"] is False
    assert body["has_config"] is False
    assert body["has_result"] is False


def test_workspace_reset(client: TestClient) -> None:
    res = client.post("/api/workspace/reset")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_jobs_list_empty(client: TestClient) -> None:
    res = client.get("/api/jobs/")
    assert res.status_code == 200
    assert res.json() == []


def test_job_not_found(client: TestClient) -> None:
    res = client.get("/api/jobs/nonexistent")
    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "JOB_NOT_FOUND"
