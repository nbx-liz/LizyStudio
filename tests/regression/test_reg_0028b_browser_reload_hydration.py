"""Regression tests for browser-reload state hydration (Issue #28 (b)).

Per BLUEPRINT.md, the server-side ``WorkspaceState`` is the source of
truth that survives a browser reload — the SPA queries
``GET /api/workspace/status`` on mount and rehydrates Data Panel state
from it (PR #367 / Issue #363).

These tests lock the *backend* contract that the rehydration flow
depends on:

- After a successful data load, ``GET /status`` reflects ``has_data``
  + ``data_ref`` (filename + shape).
- The status endpoint is **idempotent** — repeated GETs return the
  same payload, since "browser reload" boils down to a fresh GET.
- After a config PUT, ``has_config`` flips and persists across GETs.
- ``has_result`` stays ``False`` even when data + config are present:
  per BLUEPRINT.md §4.2.3, results are volatile and never restored
  from disk.
- ``workspace/reset`` clears all three flags atomically.
- ``data_ref`` carries the *resolved* filename (not the user-typed
  path) so the SPA can show a stable label after symlink swaps.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _create_csv(tmp_path: Path, rows: int = 30) -> str:
    csv_path = tmp_path / "train.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "target"])
        for i in range(rows):
            writer.writerow([i, 20 + i, i % 2])
    return str(csv_path)


def _valid_config(client: TestClient) -> dict:
    res = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert res.status_code == 200
    return res.json()


def test_status_initial_state_is_empty(client: TestClient) -> None:
    """Without any data load, status returns the empty hydration shape."""
    r = client.get("/api/workspace/status")
    assert r.status_code == 200
    body = r.json()
    assert body["has_data"] is False
    assert body["has_config"] is False
    assert body["has_result"] is False
    assert body["data_ref"] is None
    assert body["current_job_id"] is None


def test_status_reflects_data_after_load(client: TestClient, tmp_path: Path) -> None:
    """Loading a file must surface in the next ``GET /status`` so the
    SPA's ``useWorkspaceStatus`` query can rehydrate Data Panel.
    """
    csv_path = _create_csv(tmp_path, rows=50)
    r = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert r.status_code == 200

    r = client.get("/api/workspace/status")
    assert r.status_code == 200
    body = r.json()
    assert body["has_data"] is True
    assert body["has_config"] is False
    assert body["has_result"] is False
    assert body["data_ref"] is not None
    assert body["data_ref"]["filename"] == "train.csv"
    assert body["data_ref"]["shape"] == [50, 3]


def test_status_is_idempotent_across_reloads(
    client: TestClient, tmp_path: Path
) -> None:
    """A "browser reload" is just another ``GET /status``. Three
    sequential reads must return identical payloads — the endpoint
    must not mutate or consume state.
    """
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})
    config = _valid_config(client)
    client.put("/api/workspace/config", json=config)

    payloads = [client.get("/api/workspace/status").json() for _ in range(3)]
    assert payloads[0] == payloads[1] == payloads[2]
    assert payloads[0]["has_data"] is True
    assert payloads[0]["has_config"] is True


def test_status_reflects_config_after_put(client: TestClient, tmp_path: Path) -> None:
    """``has_config`` flips on a successful PUT and persists across
    subsequent reads, so a SPA reload after the user edited the form
    sees the persisted config.
    """
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})

    before = client.get("/api/workspace/status").json()
    assert before["has_config"] is False

    config = _valid_config(client)
    r = client.put("/api/workspace/config", json=config)
    assert r.status_code == 200 and r.json()["saved"] is True

    after = client.get("/api/workspace/status").json()
    assert after["has_config"] is True
    # data_ref unchanged: config write must not clobber the data load.
    assert after["data_ref"] == before["data_ref"]


def test_has_result_stays_false_until_a_job_completes(
    client: TestClient, tmp_path: Path
) -> None:
    """BLUEPRINT.md §4.2.3: workspace results are volatile and never
    restored from disk — even after a full data + config load,
    ``has_result`` must remain ``False`` until a Fit/Tune job finishes
    in the same process. This regression test guards against accidental
    persistence (e.g. someone wiring ``workspace_fit_result`` into the
    versioned-JSON storage).
    """
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})
    config = _valid_config(client)
    client.put("/api/workspace/config", json=config)

    body = client.get("/api/workspace/status").json()
    assert body["has_data"] is True
    assert body["has_config"] is True
    assert body["has_result"] is False


def test_reset_clears_all_status_flags(client: TestClient, tmp_path: Path) -> None:
    """A user-initiated reset must clear data, config, and any result
    flag in one shot so a subsequent reload sees the empty state.
    """
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})
    config = _valid_config(client)
    client.put("/api/workspace/config", json=config)

    populated = client.get("/api/workspace/status").json()
    assert populated["has_data"] is True
    assert populated["has_config"] is True

    r = client.post("/api/workspace/reset")
    assert r.status_code == 200

    cleared = client.get("/api/workspace/status").json()
    assert cleared["has_data"] is False
    assert cleared["has_config"] is False
    assert cleared["has_result"] is False
    assert cleared["data_ref"] is None


def test_data_ref_filename_is_resolved_basename(
    client: TestClient, tmp_path: Path
) -> None:
    """The status payload exposes the resolved filename (basename),
    not the user-typed path. This keeps the SPA's hydration code from
    showing the absolute path and makes the label stable across
    symlink swaps that the server resolves at load time.
    """
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})

    body = client.get("/api/workspace/status").json()
    assert body["data_ref"]["filename"] == "train.csv"
    # filename is a bare basename, never a path component.
    assert "/" not in body["data_ref"]["filename"]
