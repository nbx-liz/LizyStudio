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


def test_data_load_path_outside_root_shows_hint(client: TestClient) -> None:
    """Error message should include the allowed root path for guidance."""
    res = client.post("/api/workspace/data/path", json={"path": "/etc/passwd"})
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "PATH_NOT_FOUND"
    assert "allowed root" in body["error"]["message"].lower()


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


# ---------------------------------------------------------------------------
# Edge cases: corrupted/malformed data files (#1), duplicate columns (#17)
# ---------------------------------------------------------------------------


def test_data_load_csv_malformed_rows(client: TestClient, tmp_path: Path) -> None:
    """CSV with inconsistent column counts should be handled."""
    csv_path = tmp_path / "bad.csv"
    csv_path.write_text("a,b,c\n1,2,3\n4,5\n6,7,8,9\n", encoding="utf-8")
    res = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    # pandas handles ragged CSVs; verify it either loads or rejects
    assert res.status_code in (200, 400)


def test_data_load_invalid_parquet(client: TestClient, tmp_path: Path) -> None:
    """Random bytes with .parquet extension should fail."""
    bad_path = tmp_path / "corrupt.parquet"
    bad_path.write_bytes(b"\x00\x01\x02random garbage")
    res = client.post("/api/workspace/data/path", json={"path": str(bad_path)})
    assert res.status_code == 400
    assert res.json()["error"]["code"] in (
        "FILE_INVALID",
        "PATH_NOT_FOUND",
    )


def test_data_upload_corrupted_csv(client: TestClient) -> None:
    """Upload endpoint with non-parseable bytes should fail."""
    res = client.post(
        "/api/workspace/data/upload",
        files={
            "file": (
                "bad.csv",
                b"\xff\xfe\x00\x01binary",
                "text/csv",
            )
        },
    )
    assert res.status_code >= 400


def test_data_load_csv_encoding_latin1(client: TestClient, tmp_path: Path) -> None:
    """Latin-1 encoded CSV should either load or return clear error."""
    csv_path = tmp_path / "latin1.csv"
    csv_path.write_bytes("name,value\nCaf\xe9,1\n".encode("latin-1"))
    res = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    # pandas may auto-detect encoding or fail
    assert res.status_code in (200, 400)


def test_data_load_duplicate_columns(client: TestClient, tmp_path: Path) -> None:
    """CSV with duplicate column names should load (pandas renames)."""
    csv_path = tmp_path / "dupcols.csv"
    csv_path.write_text("a,a,b\n1,2,3\n4,5,6\n", encoding="utf-8")
    res = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    assert res.status_code == 200
    body = res.json()
    assert body["data_ref"]["shape"] == [2, 3]


def test_data_upload_duplicate_columns(client: TestClient) -> None:
    """Upload with duplicate column names should load."""
    content = b"x,x,y\n1,2,3\n4,5,6\n"
    res = client.post(
        "/api/workspace/data/upload",
        files={"file": ("dup.csv", content, "text/csv")},
    )
    assert res.status_code == 200
    assert res.json()["data_ref"]["shape"] == [2, 3]


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
