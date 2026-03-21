"""Test config defaults round-trip through PUT /config.

Reproduces the E2E failure in workspace-flow.spec.ts where:
  GET /config/defaults -> PUT /config -> saved: false
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def test_csv(tmp_path: Path) -> Path:
    """Create a simple binary-classification CSV."""
    csv_path = tmp_path / "test_data.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "gender", "target"])
        for i in range(100):
            writer.writerow([i, 20 + (i % 50), "M" if i % 2 == 0 else "F", i % 2])
    return csv_path


class TestConfigRoundTrip:
    def test_defaults_config_saves_successfully(
        self, client: TestClient, test_csv: Path
    ) -> None:
        """Config from GET /defaults should be saveable via PUT /config."""
        # 1. Load data
        load_res = client.post("/api/workspace/data/path", json={"path": str(test_csv)})
        assert load_res.status_code == 200

        # 2. Get defaults
        defaults_res = client.get(
            "/api/workspace/config/defaults?task=binary&target=target"
        )
        assert defaults_res.status_code == 200
        defaults = defaults_res.json()
        assert defaults["task"] == "binary"

        # 3. PUT config (this is the step that fails in E2E)
        put_res = client.put("/api/workspace/config", json=defaults)
        assert put_res.status_code == 200
        body = put_res.json()

        # Diagnose: print errors if save failed
        if not body.get("saved"):
            pytest.fail(f"Config save failed with errors: {body.get('errors')}")

        assert body["saved"] is True

    def test_defaults_config_with_data_path_saves(
        self, client: TestClient, test_csv: Path
    ) -> None:
        """Config from GET /defaults merged with data.path should save."""
        # 1. Load data
        load_res = client.post("/api/workspace/data/path", json={"path": str(test_csv)})
        assert load_res.status_code == 200
        data_path = load_res.json()["data_ref"]["path"]

        # 2. Get defaults
        defaults_res = client.get(
            "/api/workspace/config/defaults?task=binary&target=target"
        )
        defaults = defaults_res.json()

        # 3. Merge data.path (as the real frontend does)
        defaults["data"]["path"] = data_path

        # 4. PUT config
        put_res = client.put("/api/workspace/config", json=defaults)
        body = put_res.json()

        if not body.get("saved"):
            pytest.fail(f"Config save failed with errors: {body.get('errors')}")

        assert body["saved"] is True

    def test_workspace_has_config_after_successful_save(
        self, client: TestClient, test_csv: Path
    ) -> None:
        """After PUT /config, status shows has_config=True."""
        client.post("/api/workspace/data/path", json={"path": str(test_csv)})
        defaults = client.get(
            "/api/workspace/config/defaults?task=binary&target=target"
        ).json()

        put_res = client.put("/api/workspace/config", json=defaults)
        body = put_res.json()

        # If save succeeded, check status
        if body.get("saved"):
            status = client.get("/api/workspace/status").json()
            assert status["has_config"] is True
        else:
            # If save fails, the test should tell us why
            pytest.fail(f"Config save failed: {body.get('errors')}")
