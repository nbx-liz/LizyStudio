"""Data loading and column analysis service (BLUEPRINT §4.2.1, §5.2 Data)."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Literal

import pandas as pd

from lizystudio.backends.types import ColumnInfo, ColumnsResponse, DataRef


def load_dataframe(path: str) -> pd.DataFrame:
    """Load a CSV or Parquet file into a DataFrame."""
    p = Path(path)
    if p.suffix == ".parquet":
        return pd.read_parquet(p)
    return pd.read_csv(p)


def make_data_ref(
    df: pd.DataFrame,
    *,
    source_type: Literal["path", "upload"],
    path: str,
    filename: str,
) -> DataRef:
    """Build a DataRef with a fingerprint from the DataFrame content."""
    hash_bytes: bytes = pd.util.hash_pandas_object(df).values.tobytes()  # type: ignore[union-attr]
    fingerprint = hashlib.sha256(hash_bytes).hexdigest()[:16]
    return DataRef(
        source_type=source_type,
        path=path,
        filename=filename,
        fingerprint=fingerprint,
        shape=(df.shape[0], df.shape[1]),
    )


def get_preview(df: pd.DataFrame, rows: int = 50) -> dict[str, Any]:
    """Return first N rows as JSON-serializable dict."""
    preview = df.head(rows)
    return {
        "columns": list(preview.columns),
        "data": preview.fillna("").to_dict("records"),
        "total_rows": len(df),
        "total_cols": len(df.columns),
    }


def analyze_columns(
    df: pd.DataFrame,
    target: str | None = None,
) -> ColumnsResponse:
    """Analyze columns with auto-detection per BLUEPRINT §4.2.1."""
    n_rows = len(df)
    columns: list[ColumnInfo] = []

    for col in df.columns:
        if col == target:
            continue
        series = df[col]
        dtype_str = str(series.dtype)
        unique_count = int(series.nunique())

        suggested_excluded = False
        exclude_reason: Literal["id", "constant"] | None = None
        suggested_type: Literal["numeric", "categorical"]

        # Auto-exclusion rules
        if unique_count == n_rows:
            suggested_excluded = True
            exclude_reason = "id"
        elif unique_count <= 1:
            suggested_excluded = True
            exclude_reason = "constant"

        # Type suggestion
        if series.dtype == "object" or series.dtype.name in (
            "string",
            "category",
            "bool",
            "boolean",
        ):
            suggested_type = "categorical"
        elif pd.api.types.is_numeric_dtype(series):
            threshold = max(20, int(n_rows * 0.05))
            suggested_type = "categorical" if unique_count <= threshold else "numeric"
        else:
            suggested_type = "categorical"

        columns.append(
            ColumnInfo(
                name=str(col),
                dtype=dtype_str,
                unique_count=unique_count,
                suggested_type=suggested_type,
                suggested_excluded=suggested_excluded,
                exclude_reason=exclude_reason,
            )
        )

    # Auto-detect task from target column (BLUEPRINT §4.2.1)
    suggested_task: Literal["binary", "multiclass", "regression"] | None = None
    if target and target in df.columns:
        target_series = df[target]
        target_unique = int(target_series.nunique())
        threshold = max(20, int(n_rows * 0.05))
        if target_unique == 2:
            suggested_task = "binary"
        elif target_series.dtype == "object" or target_series.dtype.name == "category":
            # Object/category dtype is always multiclass (BLUEPRINT §4.2.1)
            suggested_task = "multiclass"
        elif target_unique <= threshold:
            suggested_task = "multiclass"
        else:
            suggested_task = "regression"

    return ColumnsResponse(
        target=target, suggested_task=suggested_task, columns=columns
    )


def get_describe(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Return descriptive statistics for numeric columns."""
    desc = df.describe(include="all")
    col_stats: dict[str, Any] = desc.to_dict()  # type: ignore[assignment]
    return [{"column": col, **stats} for col, stats in col_stats.items()]
