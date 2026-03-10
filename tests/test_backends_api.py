"""Tests for GET /api/backends (BLUEPRINT §5.6, H-0014)."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_list_backends(client: TestClient) -> None:
    resp = client.get("/api/backends")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert data[0]["name"] == "lizyml"
    assert "version" in data[0]
