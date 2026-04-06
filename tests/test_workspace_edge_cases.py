"""Edge case tests for workspace API: validation errors, upload errors, config paths."""

from __future__ import annotations

import csv
from pathlib import Path
from unittest.mock import patch

import yaml
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_csv(tmp_path: Path) -> str:
    csv_path = tmp_path / "train.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "target"])
        for i in range(50):
            writer.writerow([i, 20 + i, i % 2])
    return str(csv_path)


def _load_valid_config(client: TestClient) -> dict:
    res = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert res.status_code == 200
    return res.json()


def _load_data_and_config(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    r = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert r.status_code == 200
    config = _load_valid_config(client)
    r = client.put("/api/workspace/config", json=config)
    assert r.status_code == 200 and r.json()["saved"] is True


# ---------------------------------------------------------------------------
# Fit validation errors
# ---------------------------------------------------------------------------


def test_fit_returns_400_on_validation_error(
    client: TestClient, tmp_path: Path
) -> None:
    """POST /fit with invalid config returns VALIDATION_ERROR."""
    _load_data_and_config(client, tmp_path)

    # Now mock validate_config to return errors (simulating config that became invalid)
    with patch(
        "lizystudio.api.workspace.validate_config",
        return_value=[{"loc": ["model"], "msg": "invalid", "type": "value_error"}],
    ):
        res = client.post("/api/workspace/fit")
    assert res.status_code in (400, 422)
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# Tune validation errors
# ---------------------------------------------------------------------------


def test_tune_returns_400_on_validation_error(
    client: TestClient, tmp_path: Path
) -> None:
    """POST /tune with invalid config returns VALIDATION_ERROR."""
    _load_data_and_config(client, tmp_path)

    with patch(
        "lizystudio.api.workspace.validate_config",
        return_value=[{"loc": ["tuning"], "msg": "invalid", "type": "value_error"}],
    ):
        res = client.post("/api/workspace/tune")
    assert res.status_code in (400, 422)
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# Config upload edge cases
# ---------------------------------------------------------------------------


def test_config_upload_non_dict_yaml(client: TestClient) -> None:
    """Uploading a YAML that parses to a list should return FILE_INVALID."""
    yaml_bytes = b"- item1\n- item2\n"
    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("config.yaml", yaml_bytes, "application/x-yaml")},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] in ("FILE_INVALID", "CONFIG_IMPORT_ERROR")


def test_config_upload_empty_file(client: TestClient) -> None:
    """Uploading an empty config file should return an error."""
    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("config.yaml", b"", "application/x-yaml")},
    )
    # Empty YAML → None → FILE_INVALID
    assert res.status_code == 400


def test_config_upload_json_malformed(client: TestClient) -> None:
    """Uploading malformed JSON should return FILE_INVALID."""
    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("config.json", b"{broken json", "application/json")},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] in ("FILE_INVALID", "CONFIG_IMPORT_ERROR")


# ---------------------------------------------------------------------------
# Config validate edge cases
# ---------------------------------------------------------------------------


def test_config_validate_no_body_no_config(client: TestClient) -> None:
    """POST /config/validate with no body and no stored config → WORKSPACE_NO_CONFIG."""
    res = client.post("/api/workspace/config/validate")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"


def test_config_validate_with_stored_config(client: TestClient) -> None:
    """POST /config/validate with no body uses stored config."""
    config = _load_valid_config(client)
    client.put("/api/workspace/config", json=config)

    res = client.post("/api/workspace/config/validate")
    assert res.status_code == 200
    body = res.json()
    assert "valid" in body


# ---------------------------------------------------------------------------
# Config download
# ---------------------------------------------------------------------------


def test_config_download_no_config(client: TestClient) -> None:
    """GET /config/download with no config returns WORKSPACE_NO_CONFIG."""
    res = client.get("/api/workspace/config/download")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"


def test_config_download_returns_yaml(client: TestClient) -> None:
    """GET /config/download returns valid YAML content."""
    config = _load_valid_config(client)
    client.put("/api/workspace/config", json=config)

    res = client.get("/api/workspace/config/download")
    assert res.status_code == 200
    assert "application/x-yaml" in res.headers["content-type"]
    # Should be valid YAML
    parsed = yaml.safe_load(res.content)
    assert isinstance(parsed, dict)
    assert parsed["task"] == "binary"


# ---------------------------------------------------------------------------
# Data endpoints without data
# ---------------------------------------------------------------------------


def test_data_describe_no_data(client: TestClient) -> None:
    """GET /data/describe with no loaded data returns WORKSPACE_NO_DATA."""
    res = client.get("/api/workspace/data/describe")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_DATA"


def test_data_columns_no_data(client: TestClient) -> None:
    """GET /data/columns with no loaded data returns WORKSPACE_NO_DATA."""
    res = client.get("/api/workspace/data/columns")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_DATA"
