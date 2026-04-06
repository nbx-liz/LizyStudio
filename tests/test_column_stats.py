"""Tests for GET /api/workspace/data/column-stats/{col} endpoint (H-0046)."""

from __future__ import annotations

import csv
from pathlib import Path

from fastapi.testclient import TestClient


def _create_csv(tmp_path: Path) -> str:
    """Create a CSV with known value distributions."""
    csv_path = tmp_path / "stats_test.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "city", "score", "target"])
        cities = ["Tokyo", "Osaka", "Nagoya", "Fukuoka", "Sapporo"]
        for i in range(100):
            writer.writerow([i, cities[i % 5], i * 1.5, i % 2])
    return str(csv_path)


def _load_data(client: TestClient, csv_path: str) -> None:
    res = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert res.status_code == 200


def test_column_stats_categorical(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    _load_data(client, csv_path)

    res = client.get("/api/workspace/data/column-stats/city")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "city"
    assert body["unique_count"] == 5
    assert body["total_count"] == 100
    assert body["null_count"] == 0
    # Should have 5 value counts (no "other" since <= top_n)
    assert len(body["value_counts"]) == 5
    # Each city should appear 20 times
    for vc in body["value_counts"]:
        assert vc["count"] == 20


def test_column_stats_numeric(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    _load_data(client, csv_path)

    res = client.get("/api/workspace/data/column-stats/score")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "score"
    assert body["total_count"] == 100
    assert len(body["value_counts"]) > 0


def test_column_stats_top_n(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    _load_data(client, csv_path)

    # Request only top 3
    res = client.get("/api/workspace/data/column-stats/city?top_n=3")
    assert res.status_code == 200
    body = res.json()
    # Should have 3 top values + 1 "__other__" bucket
    assert len(body["value_counts"]) == 4
    other = [vc for vc in body["value_counts"] if vc["value"] == "__other__"]
    assert len(other) == 1
    assert other[0]["count"] == 40  # 2 remaining cities x 20 each


def test_column_stats_not_found(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    _load_data(client, csv_path)

    res = client.get("/api/workspace/data/column-stats/nonexistent")
    assert res.status_code == 400


def test_column_stats_no_data(client: TestClient) -> None:
    res = client.get("/api/workspace/data/column-stats/city")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_DATA"
