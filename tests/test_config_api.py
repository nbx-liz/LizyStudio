"""Tests for Workspace Config API endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _get_valid_config(client: TestClient) -> dict:
    """Fetch a valid default config from the API."""
    res = client.get("/api/workspace/config/defaults?task=binary&target=y")
    assert res.status_code == 200
    return res.json()


def test_config_schema(client: TestClient) -> None:
    res = client.get("/api/workspace/config/schema")
    assert res.status_code == 200
    body = res.json()
    assert "properties" in body


def test_config_get_empty(client: TestClient) -> None:
    res = client.get("/api/workspace/config")
    assert res.status_code == 200
    assert res.json() == {}


def test_config_put_invalid_not_saved(client: TestClient) -> None:
    """Partial config with validation errors should NOT be saved."""
    config = {"task": "binary", "model": {"name": "lightgbm"}}
    res = client.put("/api/workspace/config", json=config)
    assert res.status_code == 200
    body = res.json()
    assert body["config"]["task"] == "binary"
    assert isinstance(body["errors"], list)
    assert len(body["errors"]) > 0
    assert body["saved"] is False
    # Config should still be empty
    res2 = client.get("/api/workspace/config")
    assert res2.json() == {}


def test_config_put_valid_saved(client: TestClient) -> None:
    """Valid config should be saved successfully."""
    config = _get_valid_config(client)
    res = client.put("/api/workspace/config", json=config)
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    assert body["errors"] == []


def test_config_get_after_put(client: TestClient) -> None:
    config = _get_valid_config(client)
    client.put("/api/workspace/config", json=config)
    res = client.get("/api/workspace/config")
    assert res.status_code == 200
    assert res.json()["task"] == "binary"


def test_config_validate_empty_body(client: TestClient) -> None:
    """Empty dict body is treated as 'no config' since it has no fields."""
    res = client.post("/api/workspace/config/validate", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"


def test_config_validate_invalid_config(client: TestClient) -> None:
    """Config with invalid fields should return validation errors."""
    res = client.post(
        "/api/workspace/config/validate",
        json={"task": "invalid_task"},
    )
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
    config = _get_valid_config(client)
    client.put("/api/workspace/config", json=config)
    res = client.get("/api/workspace/config/download")
    assert res.status_code == 200
    assert "task: binary" in res.text
    assert res.headers["content-type"] == "application/x-yaml"


def test_config_download_empty(client: TestClient) -> None:
    res = client.get("/api/workspace/config/download")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"


# --- Default config (H-0025) ---


def test_config_defaults_binary(client: TestClient) -> None:
    res = client.get("/api/workspace/config/defaults?task=binary&target=y")
    assert res.status_code == 200
    body = res.json()
    assert body["task"] == "binary"
    assert body["config_version"] == 1
    assert body["data"]["target"] == "y"
    assert body["model"]["name"] == "lgbm"
    assert body["split"]["method"] == "stratified_kfold"
    assert body["split"]["n_splits"] == 5
    # P-0104 Wave 2.2 / Issue #459: Studio overrides library seed=42 with 1120
    # so fresh Fit-tab configs match the Tune-tab catalog seed default.
    assert body["training"]["seed"] == 1120
    assert body["training"]["early_stopping"]["enabled"] is True
    assert body["training"]["early_stopping"]["rounds"] == 150


def test_config_defaults_regression(client: TestClient) -> None:
    res = client.get("/api/workspace/config/defaults?task=regression&target=price")
    assert res.status_code == 200
    body = res.json()
    assert body["task"] == "regression"
    assert body["data"]["target"] == "price"
    assert body["split"]["method"] == "kfold"


def test_config_defaults_multiclass(client: TestClient) -> None:
    res = client.get("/api/workspace/config/defaults?task=multiclass&target=species")
    assert res.status_code == 200
    body = res.json()
    assert body["task"] == "multiclass"
    assert body["split"]["method"] == "stratified_kfold"


def test_config_defaults_validates(client: TestClient) -> None:
    """Default config should pass validation without errors."""
    res = client.get("/api/workspace/config/defaults?task=binary&target=y")
    defaults = res.json()
    res2 = client.post("/api/workspace/config/validate", json=defaults)
    assert res2.status_code == 200
    body = res2.json()
    assert body["valid"] is True
    assert body["errors"] == []


def test_config_validate_no_body_uses_workspace_config(client: TestClient) -> None:
    """No-body validate should use current workspace config."""
    # Set a valid config first
    defaults = _get_valid_config(client)
    client.put("/api/workspace/config", json=defaults)
    # Validate without body
    res = client.post("/api/workspace/config/validate")
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is True


def test_config_validate_no_body_no_config(client: TestClient) -> None:
    """No-body validate with no config set returns error."""
    res = client.post("/api/workspace/config/validate")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"


def test_config_defaults_missing_params(client: TestClient) -> None:
    res = client.get("/api/workspace/config/defaults")
    assert res.status_code == 422
