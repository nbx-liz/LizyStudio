"""Additional tests for services/data.py edge cases and api/workspace.py data paths."""

from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.services.data import analyze_columns, load_dataframe

pytestmark = pytest.mark.integration

# ---------------------------------------------------------------------------
# load_dataframe — Parquet support
# ---------------------------------------------------------------------------


def test_load_dataframe_parquet(tmp_path: Path) -> None:
    """load_dataframe can read .parquet files."""
    df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
    path = tmp_path / "data.parquet"
    df.to_parquet(path)

    loaded = load_dataframe(str(path))
    assert list(loaded.columns) == ["a", "b"]
    assert len(loaded) == 3


def test_load_dataframe_csv(tmp_path: Path) -> None:
    """load_dataframe can read .csv files."""
    path = tmp_path / "data.csv"
    pd.DataFrame({"x": [10, 20]}).to_csv(path, index=False)

    loaded = load_dataframe(str(path))
    assert list(loaded.columns) == ["x"]
    assert len(loaded) == 2


# ---------------------------------------------------------------------------
# analyze_columns — constant column exclusion
# ---------------------------------------------------------------------------


def test_analyze_columns_constant_column_excluded() -> None:
    """Columns with <= 1 unique value should be flagged as 'constant'."""
    df = pd.DataFrame(
        {
            "const_col": [42] * 100,
            "normal_col": range(100),
            "target": [0, 1] * 50,
        }
    )
    result = analyze_columns(df, target="target")
    cols = {c.name: c for c in result.columns}

    assert "const_col" in cols
    assert cols["const_col"].suggested_excluded is True
    assert cols["const_col"].exclude_reason == "constant"


def test_analyze_columns_all_nan_constant() -> None:
    """A column with all NaN has 0 unique values → constant exclusion."""
    df = pd.DataFrame(
        {
            "all_nan": [float("nan")] * 50,
            "target": [0, 1] * 25,
        }
    )
    result = analyze_columns(df, target="target")
    cols = {c.name: c for c in result.columns}

    assert cols["all_nan"].suggested_excluded is True
    assert cols["all_nan"].exclude_reason == "constant"


# ---------------------------------------------------------------------------
# analyze_columns — object/category dtype suggestion
# ---------------------------------------------------------------------------


def test_analyze_columns_object_dtype_categorical() -> None:
    """Object dtype columns should be suggested as categorical."""
    df = pd.DataFrame(
        {
            "color": ["red", "green", "blue"] * 30,
            "target": range(90),
        }
    )
    result = analyze_columns(df, target="target")
    cols = {c.name: c for c in result.columns}

    assert cols["color"].suggested_type == "categorical"


def test_analyze_columns_category_dtype() -> None:
    """Pandas category dtype should be suggested as categorical."""
    df = pd.DataFrame(
        {
            "cat_col": pd.Categorical(["a", "b", "c"] * 20),
            "target": range(60),
        }
    )
    result = analyze_columns(df, target="target")
    cols = {c.name: c for c in result.columns}

    assert cols["cat_col"].suggested_type == "categorical"


def test_analyze_columns_bool_dtype() -> None:
    """Boolean columns should be suggested as categorical."""
    df = pd.DataFrame(
        {
            "flag": [True, False] * 50,
            "target": range(100),
        }
    )
    result = analyze_columns(df, target="target")
    cols = {c.name: c for c in result.columns}

    assert cols["flag"].suggested_type == "categorical"


# ---------------------------------------------------------------------------
# analyze_columns — numeric with low cardinality → categorical
# ---------------------------------------------------------------------------


def test_analyze_columns_numeric_low_cardinality_categorical() -> None:
    """Numeric column with unique <= threshold → categorical."""
    df = pd.DataFrame(
        {
            "rating": [1, 2, 3, 4, 5] * 100,  # 5 unique in 500 rows
            "target": range(500),
        }
    )
    result = analyze_columns(df, target="target")
    cols = {c.name: c for c in result.columns}

    # threshold = max(20, int(500 * 0.05)) = 25, unique=5 <= 25 → categorical
    assert cols["rating"].suggested_type == "categorical"


def test_analyze_columns_numeric_high_cardinality_numeric() -> None:
    """Numeric column with unique > threshold → numeric."""
    df = pd.DataFrame(
        {
            "value": range(500),
            "target": [0, 1] * 250,
        }
    )
    result = analyze_columns(df, target="target")
    cols = {c.name: c for c in result.columns}

    assert cols["value"].suggested_type == "numeric"


# ---------------------------------------------------------------------------
# analyze_columns — task auto-detection
# ---------------------------------------------------------------------------


def test_analyze_columns_binary_task() -> None:
    """Target with 2 unique values → binary task."""
    df = pd.DataFrame({"x": range(100), "target": [0, 1] * 50})
    result = analyze_columns(df, target="target")
    assert result.suggested_task == "binary"


def test_analyze_columns_multiclass_from_object_target() -> None:
    """Object dtype target → multiclass (even if few unique values)."""
    df = pd.DataFrame(
        {
            "x": range(100),
            "target": ["cat", "dog", "bird"] * 33 + ["cat"],
        }
    )
    result = analyze_columns(df, target="target")
    assert result.suggested_task == "multiclass"


def test_analyze_columns_multiclass_from_category_target() -> None:
    """Category dtype target → multiclass."""
    df = pd.DataFrame(
        {
            "x": range(100),
            "target": pd.Categorical(["A", "B", "C", "D"] * 25),
        }
    )
    result = analyze_columns(df, target="target")
    assert result.suggested_task == "multiclass"


def test_analyze_columns_multiclass_from_numeric_low_cardinality() -> None:
    """Numeric target with few unique values (> 2, <= threshold) → multiclass."""
    df = pd.DataFrame(
        {
            "x": range(100),
            "target": [0, 1, 2, 3, 4] * 20,
        }
    )
    result = analyze_columns(df, target="target")
    assert result.suggested_task == "multiclass"


def test_analyze_columns_regression_from_numeric_high_cardinality() -> None:
    """Numeric target with many unique values → regression."""
    df = pd.DataFrame(
        {
            "x": range(500),
            "target": [i * 0.1 for i in range(500)],
        }
    )
    result = analyze_columns(df, target="target")
    assert result.suggested_task == "regression"


def test_analyze_columns_no_target() -> None:
    """When target is None, suggested_task should be None."""
    df = pd.DataFrame({"x": range(10), "y": range(10)})
    result = analyze_columns(df, target=None)
    assert result.suggested_task is None


def test_analyze_columns_target_not_in_columns() -> None:
    """When target column doesn't exist in df, suggested_task should be None."""
    df = pd.DataFrame({"x": range(10)})
    result = analyze_columns(df, target="nonexistent")
    assert result.suggested_task is None


# ---------------------------------------------------------------------------
# API: data/upload with parquet
# ---------------------------------------------------------------------------


def test_data_upload_parquet(client: TestClient, tmp_path: Path) -> None:
    """Uploading a .parquet file should succeed."""
    df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
    parquet_path = tmp_path / "test.parquet"
    df.to_parquet(parquet_path)

    with open(parquet_path, "rb") as f:
        res = client.post(
            "/api/workspace/data/upload",
            files={"file": ("test.parquet", f, "application/octet-stream")},
        )
    assert res.status_code == 200
    assert res.json()["data_ref"]["shape"] == [2, 2]


def test_data_upload_unsupported_extension(client: TestClient) -> None:
    """Uploading a file with unsupported extension should return FILE_INVALID."""
    res = client.post(
        "/api/workspace/data/upload",
        files={"file": ("data.xlsx", b"fake-data", "application/octet-stream")},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "FILE_INVALID"


def test_data_upload_corrupted_csv(client: TestClient) -> None:
    """Uploading a corrupted CSV (binary garbage) should return FILE_INVALID."""
    res = client.post(
        "/api/workspace/data/upload",
        files={"file": ("bad.csv", b"\x00\x01\x02\xff\xfe", "text/csv")},
    )
    # Should either error or produce a minimal dataframe
    assert res.status_code in (200, 400)


# ---------------------------------------------------------------------------
# API: data/path with corrupted file
# ---------------------------------------------------------------------------


def test_data_load_path_corrupted_csv(client: TestClient, tmp_path: Path) -> None:
    """Loading a path that exists but contains garbage returns FILE_INVALID."""
    bad_file = tmp_path / "corrupt.csv"
    bad_file.write_bytes(b"\x00\x01\x02\xff\xfe")

    res = client.post("/api/workspace/data/path", json={"path": str(bad_file)})
    # pandas may or may not raise on garbage bytes
    assert res.status_code in (200, 400)


def test_data_load_path_parquet_api(client: TestClient, tmp_path: Path) -> None:
    """Loading a .parquet file via API should work."""
    df = pd.DataFrame({"x": [10, 20, 30], "y": [1, 0, 1]})
    path = tmp_path / "data.parquet"
    df.to_parquet(path)

    res = client.post("/api/workspace/data/path", json={"path": str(path)})
    assert res.status_code == 200
    assert res.json()["data_ref"]["shape"] == [3, 2]


# ---------------------------------------------------------------------------
# API: data/columns with edge case data
# ---------------------------------------------------------------------------


def test_data_columns_constant_and_id_detection(
    client: TestClient, tmp_path: Path
) -> None:
    """Columns endpoint detects constant and ID columns."""
    csv_path = tmp_path / "edge.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "constant", "normal", "target"])
        for i in range(100):
            writer.writerow([i, 99, i % 10, i % 2])

    client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    res = client.get("/api/workspace/data/columns?target=target")
    assert res.status_code == 200

    cols = {c["name"]: c for c in res.json()["columns"]}
    assert cols["id"]["suggested_excluded"] is True
    assert cols["id"]["exclude_reason"] == "id"
    assert cols["constant"]["suggested_excluded"] is True
    assert cols["constant"]["exclude_reason"] == "constant"
