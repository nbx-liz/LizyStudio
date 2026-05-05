"""Contract tests for ``GET /api/workspace/data/preview?max_cols=N`` (P-0097).

Locks the optional ``max_cols`` query parameter introduced for the
Wide DataFrame UI (Issue #361). Three invariants:

- INV: ``max_cols`` omitted → all columns returned (backward compat).
- INV: ``max_cols=N`` (positive) → at most N columns in ``columns`` /
  ``data`` rows; ``total_cols`` always reports the ground-truth column
  count.
- INV: ``max_cols=0`` or negative is rejected with 422 (FastAPI Query
  validation).
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _wide_csv(tmp_path: Path, n_cols: int = 50, n_rows: int = 10) -> str:
    csv_path = tmp_path / "wide.csv"
    headers = ["target_class"] + [f"f_{i:05d}" for i in range(1, n_cols)]
    with csv_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for r in range(n_rows):
            row = [r % 2] + [float(r + c) for c in range(1, n_cols)]
            w.writerow(row)
    return str(csv_path)


def _load_data(client: TestClient, path: str) -> None:
    r = client.post("/api/workspace/data/path", json={"path": path})
    assert r.status_code == 200, r.text


def test_preview_without_max_cols_returns_all_columns(
    client: TestClient, tmp_path: Path
) -> None:
    """Backward compat: omitting ``max_cols`` returns every column."""
    csv_path = _wide_csv(tmp_path, n_cols=50, n_rows=5)
    _load_data(client, csv_path)

    r = client.get("/api/workspace/data/preview?rows=5")
    assert r.status_code == 200
    body = r.json()
    assert len(body["columns"]) == 50
    assert body["total_cols"] == 50
    # Every data row carries a value for every column.
    assert all(len(row) == 50 for row in body["data"])


def test_preview_with_max_cols_caps_columns(client: TestClient, tmp_path: Path) -> None:
    """``max_cols=10`` returns the first 10 columns; ``total_cols`` still
    reports the ground-truth 50."""
    csv_path = _wide_csv(tmp_path, n_cols=50, n_rows=5)
    _load_data(client, csv_path)

    r = client.get("/api/workspace/data/preview?rows=5&max_cols=10")
    assert r.status_code == 200
    body = r.json()
    assert len(body["columns"]) == 10
    # Order preserved — target_class is column 0.
    assert body["columns"][0] == "target_class"
    assert body["total_cols"] == 50, "total_cols must reflect ground truth"
    # Each row is also capped.
    assert all(len(row) == 10 for row in body["data"])


def test_preview_max_cols_larger_than_actual_returns_all(
    client: TestClient, tmp_path: Path
) -> None:
    """``max_cols`` larger than the actual column count is a no-op
    (returns every column without raising).
    """
    csv_path = _wide_csv(tmp_path, n_cols=12, n_rows=3)
    _load_data(client, csv_path)

    r = client.get("/api/workspace/data/preview?max_cols=999")
    assert r.status_code == 200
    body = r.json()
    assert len(body["columns"]) == 12


def test_preview_max_cols_zero_rejected(client: TestClient, tmp_path: Path) -> None:
    """``max_cols=0`` is invalid: FastAPI Query ge=1 returns 422."""
    csv_path = _wide_csv(tmp_path, n_cols=10, n_rows=3)
    _load_data(client, csv_path)

    r = client.get("/api/workspace/data/preview?max_cols=0")
    assert r.status_code == 422


def test_preview_max_cols_negative_rejected(client: TestClient, tmp_path: Path) -> None:
    """``max_cols=-5`` is invalid (422)."""
    csv_path = _wide_csv(tmp_path, n_cols=10, n_rows=3)
    _load_data(client, csv_path)

    r = client.get("/api/workspace/data/preview?max_cols=-5")
    assert r.status_code == 422
