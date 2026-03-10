"""Tests for Workspace Data API endpoints."""

from __future__ import annotations

import csv
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient


def _create_csv(tmp_path: Path, name: str = "train.csv") -> str:
    """Create a simple CSV file and return its path."""
    csv_path = tmp_path / name
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "gender", "target"])
        for i in range(100):
            writer.writerow([i, 20 + (i % 50), "M" if i % 2 == 0 else "F", i % 2])
    return str(csv_path)


def test_data_load_path(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    res = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert res.status_code == 200
    body = res.json()
    assert body["data_ref"]["shape"] == [100, 4]
    assert body["data_ref"]["filename"] == "train.csv"


def test_data_load_path_not_found(client: TestClient) -> None:
    res = client.post("/api/workspace/data/path", json={"path": "/nonexistent.csv"})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "PATH_NOT_FOUND"


def test_data_preview(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})
    res = client.get("/api/workspace/data/preview?rows=5")
    assert res.status_code == 200
    body = res.json()
    assert len(body["data"]) == 5
    assert body["total_rows"] == 100
    assert "id" in body["columns"]


def test_data_preview_no_data(client: TestClient) -> None:
    res = client.get("/api/workspace/data/preview")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_DATA"


def test_data_columns_auto_detection(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})
    res = client.get("/api/workspace/data/columns?target=target")
    assert res.status_code == 200
    body = res.json()
    assert body["target"] == "target"
    cols = {c["name"]: c for c in body["columns"]}
    # 'id' should be auto-excluded as ID (100 unique = 100 rows)
    assert cols["id"]["suggested_excluded"] is True
    assert cols["id"]["exclude_reason"] == "id"
    # 'gender' has 2 unique values, should be categorical
    assert cols["gender"]["suggested_type"] == "categorical"
    # suggested_task for binary target (2 unique values)
    assert body["suggested_task"] == "binary"


def test_data_describe(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})
    res = client.get("/api/workspace/data/describe")
    assert res.status_code == 200
    body = res.json()
    assert len(body) > 0
    assert "column" in body[0]


def test_data_upload(client: TestClient) -> None:
    with tempfile.NamedTemporaryFile(suffix=".csv", mode="w", delete=False) as f:
        writer = csv.writer(f)
        writer.writerow(["a", "b"])
        writer.writerow([1, 2])
        writer.writerow([3, 4])
        f.flush()
        csv_path = f.name
    with open(csv_path, "rb") as f:
        res = client.post(
            "/api/workspace/data/upload",
            files={"file": ("test.csv", f, "text/csv")},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["data_ref"]["shape"] == [2, 2]
    assert body["data_ref"]["source_type"] == "upload"
