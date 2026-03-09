"""Tests for Workspace Config API endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_config_schema(client: TestClient) -> None:
    res = client.get("/api/workspace/config/schema")
    assert res.status_code == 200
    body = res.json()
    assert "properties" in body


def test_config_get_empty(client: TestClient) -> None:
    res = client.get("/api/workspace/config")
    assert res.status_code == 200
    assert res.json() == {}


def test_config_put(client: TestClient) -> None:
    config = {"task": "binary", "model": {"name": "lightgbm"}}
    res = client.put("/api/workspace/config", json=config)
    assert res.status_code == 200
    body = res.json()
    assert body["config"]["task"] == "binary"
    # Partial config will have validation errors
    assert isinstance(body["errors"], list)


def test_config_get_after_put(client: TestClient) -> None:
    config = {"task": "regression"}
    client.put("/api/workspace/config", json=config)
    res = client.get("/api/workspace/config")
    assert res.status_code == 200
    assert res.json()["task"] == "regression"


def test_config_validate_invalid(client: TestClient) -> None:
    res = client.post("/api/workspace/config/validate", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is False
    assert len(body["errors"]) > 0


def test_config_upload_yaml(client: TestClient) -> None:
    yaml_content = b"task: binary\nmodel:\n  name: lightgbm"
    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("config.yaml", yaml_content, "application/x-yaml")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["config"]["task"] == "binary"


def test_config_download(client: TestClient) -> None:
    client.put("/api/workspace/config", json={"task": "binary"})
    res = client.get("/api/workspace/config/download")
    assert res.status_code == 200
    assert "task: binary" in res.text
    assert res.headers["content-type"] == "application/x-yaml"


def test_config_download_empty(client: TestClient) -> None:
    res = client.get("/api/workspace/config/download")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"
