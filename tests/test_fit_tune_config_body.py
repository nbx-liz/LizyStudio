"""Tests for P-0086: /api/workspace/fit and /tune accept optional config body.

Motivated by Issue #251: a race condition where ``PUT /config`` is in-flight
while ``POST /fit`` fires makes the server use a stale ``ws.config``. The
structural fix is to accept a ``{ "config": {...} }`` body on /fit and /tune
so the latest UI snapshot is applied atomically at fit/tune time.

Invariants covered:

- INV-1: body.config present → validate → ws.config overwrite → fit job
- INV-2: body.config absent → fall back to ws.config (backward compatible)
- INV-3: same behaviour for /tune
- INV-5: WorkspaceFitRequest / WorkspaceTuneRequest reject unknown top-level
  fields (extra="forbid")
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _create_csv(tmp_path: Path) -> str:
    csv_path = tmp_path / "train.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "gender", "target"])
        for i in range(50):
            writer.writerow([i, 20 + i, "M" if i % 2 == 0 else "F", i % 2])
    return str(csv_path)


def _load_data(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    r = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert r.status_code == 200


def _get_defaults(client: TestClient) -> dict[str, Any]:
    r = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert r.status_code == 200
    return r.json()


def _put_config(client: TestClient, cfg: dict[str, Any]) -> None:
    r = client.put("/api/workspace/config", json=cfg)
    assert r.status_code == 200
    assert r.json()["saved"] is True


# ---------------------------------------------------------------------------
# INV-1: body.config is applied and ws.config is overwritten
# ---------------------------------------------------------------------------


def test_fit_body_config_overwrites_ws_config(
    client: TestClient, tmp_path: Path
) -> None:
    """POST /fit with body.config updates ws.config before fit runs."""
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    _put_config(client, base)

    # Baseline: ws.config has exclude=[] (no manual excludes yet)
    cfg_before = client.get("/api/workspace/config").json()
    assert "age" not in cfg_before["features"].get("exclude", [])

    # Send fit with explicit exclude=["age"] in body
    new_cfg = {**base, "features": {**base["features"], "exclude": ["age"]}}
    r = client.post("/api/workspace/fit", json={"config": new_cfg})
    assert r.status_code == 200, r.text
    assert "job_id" in r.json()

    # ws.config must now reflect the body.config
    cfg_after = client.get("/api/workspace/config").json()
    assert cfg_after["features"]["exclude"] == ["age"]


def test_tune_body_config_overwrites_ws_config(
    client: TestClient, tmp_path: Path
) -> None:
    """POST /tune with body.config updates ws.config before tune runs."""
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    _put_config(client, base)

    new_cfg = {**base, "features": {**base["features"], "exclude": ["gender"]}}
    r = client.post("/api/workspace/tune", json={"config": new_cfg})
    assert r.status_code == 200, r.text
    assert "job_id" in r.json()

    cfg_after = client.get("/api/workspace/config").json()
    assert cfg_after["features"]["exclude"] == ["gender"]


# ---------------------------------------------------------------------------
# INV-2: body.config omitted → use ws.config (backward compatibility)
# ---------------------------------------------------------------------------


def test_fit_without_body_uses_ws_config(client: TestClient, tmp_path: Path) -> None:
    """POST /fit with no body still works and uses ws.config (regression)."""
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    _put_config(client, base)

    # Caller-preferred ergonomics: omit body entirely
    r = client.post("/api/workspace/fit")
    assert r.status_code == 200, r.text
    assert "job_id" in r.json()


def test_fit_with_empty_body_uses_ws_config(client: TestClient, tmp_path: Path) -> None:
    """POST /fit with body={} (no config field) still uses ws.config."""
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    _put_config(client, base)

    r = client.post("/api/workspace/fit", json={})
    assert r.status_code == 200, r.text


def test_tune_without_body_uses_ws_config(client: TestClient, tmp_path: Path) -> None:
    """POST /tune with no body still works and uses ws.config (regression)."""
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    _put_config(client, base)

    r = client.post("/api/workspace/tune")
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Validation: body.config that fails validate → 4xx, ws.config unchanged
# ---------------------------------------------------------------------------


def test_fit_body_config_invalid_returns_4xx_and_keeps_ws_config(
    client: TestClient, tmp_path: Path
) -> None:
    """If body.config fails backend validation, fit returns 4xx and
    ws.config is not overwritten."""
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    _put_config(client, base)
    baseline_cfg = client.get("/api/workspace/config").json()

    # Deliberately break the config: task is required and must be a known
    # literal. Passing a garbage task triggers validate_config failure.
    broken = {**base, "task": "not_a_task"}
    r = client.post("/api/workspace/fit", json={"config": broken})
    assert r.status_code in (400, 422), r.text

    # ws.config must be untouched
    after = client.get("/api/workspace/config").json()
    assert after == baseline_cfg


# ---------------------------------------------------------------------------
# INV-5: request body rejects unknown top-level fields
# ---------------------------------------------------------------------------


def test_fit_body_rejects_unknown_top_level_fields(
    client: TestClient, tmp_path: Path
) -> None:
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    _put_config(client, base)

    r = client.post(
        "/api/workspace/fit",
        json={"config": base, "mystery_field": "value"},
    )
    assert r.status_code == 422


def test_tune_body_rejects_unknown_top_level_fields(
    client: TestClient, tmp_path: Path
) -> None:
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    _put_config(client, base)

    r = client.post(
        "/api/workspace/tune",
        json={"config": base, "mystery_field": "value"},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Race-condition regression: body.config wins over stale ws.config
# ---------------------------------------------------------------------------


def test_fit_body_config_wins_over_stale_ws_config(
    client: TestClient, tmp_path: Path
) -> None:
    """Even if ws.config is stale (missing a manual exclude), the body's
    config is what ends up in ws.config after /fit."""
    _load_data(client, tmp_path)
    base = _get_defaults(client)
    # Simulate the stale state: ws.config has no manual excludes
    _put_config(client, base)

    # Fresh config from the UI with a manual exclude applied
    fresh = {**base, "features": {**base["features"], "exclude": ["age"]}}

    r = client.post("/api/workspace/fit", json={"config": fresh})
    assert r.status_code == 200

    after = client.get("/api/workspace/config").json()
    assert "age" in after["features"]["exclude"]
