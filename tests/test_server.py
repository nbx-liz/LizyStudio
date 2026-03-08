"""Smoke tests for the FastAPI application."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from lizystudio.server import app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def test_config_schema(client: TestClient) -> None:
    res = client.get("/api/config/schema")
    assert res.status_code == 200
    body = res.json()
    assert "properties" in body


def test_config_validate_invalid(client: TestClient) -> None:
    res = client.post("/api/config/validate", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is False
    assert len(body["errors"]) > 0
