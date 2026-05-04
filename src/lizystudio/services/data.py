"""Data loading and column analysis service (BLUEPRINT §4.2.1, §5.2 Data)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import pandas as pd

from lizystudio.backends.types import (
    ColumnInfo,
    ColumnsResponse,
    DataRef,
    FoldInfo,
    SplitPreview,
)


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


def get_preview(
    df: pd.DataFrame,
    rows: int = 50,
    max_cols: int | None = None,
) -> dict[str, Any]:
    """Return first N rows as a JSON-serialisable dict.

    Parameters
    ----------
    df:
        Source DataFrame.
    rows:
        Number of leading rows to include.
    max_cols:
        Optional column cap (P-0097). When provided, only the first
        ``max_cols`` columns are emitted in ``columns`` and ``data``;
        ``total_cols`` always reports the ground-truth column count so
        the SPA can show "showing N of M" without an extra round-trip.
        ``None`` preserves the pre-P-0097 behaviour of returning every
        column.
    """
    total_cols = len(df.columns)
    if max_cols is not None and max_cols < total_cols:
        preview = df.iloc[:rows, :max_cols]
    else:
        preview = df.head(rows)
    return {
        "columns": list(preview.columns),
        "data": preview.fillna("").to_dict("records"),
        "total_rows": len(df),
        "total_cols": total_cols,
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

    # Auto-detect task from target column (BLUEPRINT §4.2.1).
    # Issue #270: a single-class target is ill-posed (no signal to predict),
    # so we leave suggested_task=None and let the user pick a different
    # target. Otherwise the previous heuristic would suggest "multiclass"
    # for an all-zero target and trigger a confusing LightGBM failure.
    suggested_task: Literal["binary", "multiclass", "regression"] | None = None
    if target and target in df.columns:
        target_series = df[target]
        target_unique = int(target_series.nunique())
        threshold = max(20, int(n_rows * 0.05))
        if target_unique < 2:
            suggested_task = None
        elif target_unique == 2:
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


@dataclass
class ValueCount:
    """A single value-count pair for distribution display."""

    value: str
    count: int


@dataclass
class ColumnStats:
    """Column statistics with value distribution (H-0046)."""

    name: str
    dtype: str
    unique_count: int
    total_count: int
    null_count: int
    value_counts: list[ValueCount]


def get_column_value_counts(
    df: pd.DataFrame, col: str, *, top_n: int = 20
) -> ColumnStats:
    """Return value counts for a column, with top_n values and an 'other' bucket.

    Raises ``KeyError`` if the column does not exist.
    """
    if col not in df.columns:
        msg = f"Column '{col}' not found in DataFrame"
        raise KeyError(msg)

    series = df[col]
    total_count = len(series)
    null_count = int(series.isna().sum())
    unique_count = int(series.nunique())

    counts = series.value_counts(dropna=True)
    top = counts.head(top_n)

    value_counts: list[ValueCount] = [
        ValueCount(value=str(v), count=int(c)) for v, c in top.items()
    ]

    # Add "other" bucket if there are more values beyond top_n
    if len(counts) > top_n:
        other_count = int(counts.iloc[top_n:].sum())
        value_counts.append(ValueCount(value="__other__", count=other_count))

    return ColumnStats(
        name=col,
        dtype=str(series.dtype),
        unique_count=unique_count,
        total_count=total_count,
        null_count=null_count,
        value_counts=value_counts,
    )


# KFold-family strategies where fold sizes are computed from n_rows / n_splits
_KFOLD_STRATEGIES = frozenset(
    {
        "kfold",
        "stratified_kfold",
        "group_kfold",
        "stratified_group_kfold",
    }
)

# TimeSeriesSplit-family strategies with expanding/sliding window semantics
_TIME_SERIES_STRATEGIES = frozenset(
    {
        "time_series",
        "purged_time_series",
        "group_time_series",
    }
)


def compute_split_preview(
    n_rows: int,
    strategy: str,
    n_splits: int,
    *,
    gap: int = 0,
    max_train_size: int | None = None,
    max_test_size: int | None = None,
) -> SplitPreview:
    """Compute approximate fold sizes for a CV strategy using arithmetic only.

    No sklearn or backend calls are needed.  The calculation mirrors the
    standard scikit-learn split logic:

    * KFold-family: each fold has ``n_rows - fold_size`` train rows and
      ``fold_size`` valid rows, where ``fold_size = n_rows // n_splits``
      (larger folds get +1 row for the remainder).
    * TimeSeriesSplit-family: fold *i* has ``(i + 1) * fold_size`` train
      rows and ``fold_size`` valid rows, minus the ``gap``.
    * blocked_group_kfold: not calculable without data — returns empty folds.

    Raises ``ValueError`` if ``n_splits < 2`` or ``n_rows < n_splits``.
    """
    if n_splits < 2:
        msg = f"n_splits must be >= 2, got {n_splits}"
        raise ValueError(msg)
    if n_rows < n_splits:
        msg = f"n_rows ({n_rows}) must be >= n_splits ({n_splits})"
        raise ValueError(msg)

    folds: list[FoldInfo] = []

    if strategy in _KFOLD_STRATEGIES:
        folds = _compute_kfold(n_rows, n_splits)
    elif strategy in _TIME_SERIES_STRATEGIES:
        folds = _compute_time_series(
            n_rows,
            n_splits,
            gap=gap,
            max_train_size=max_train_size,
            max_test_size=max_test_size,
        )
    # blocked_group_kfold: cannot compute without actual data columns

    return SplitPreview(strategy=strategy, n_splits=n_splits, folds=folds)


def _compute_kfold(n_rows: int, n_splits: int) -> list[FoldInfo]:
    """KFold-family: each fold uses one partition as valid, rest as train."""
    fold_size = n_rows // n_splits
    remainder = n_rows % n_splits
    folds: list[FoldInfo] = []
    for i in range(n_splits):
        # First `remainder` folds get one extra sample
        valid_size = fold_size + (1 if i < remainder else 0)
        train_size = n_rows - valid_size
        folds.append(FoldInfo(fold=i, train_size=train_size, valid_size=valid_size))
    return folds


def _compute_time_series(
    n_rows: int,
    n_splits: int,
    *,
    gap: int = 0,
    max_train_size: int | None = None,
    max_test_size: int | None = None,
) -> list[FoldInfo]:
    """TimeSeriesSplit-family: expanding window with optional gap and caps."""
    # Mirror sklearn TimeSeriesSplit logic
    test_size = n_rows // (n_splits + 1)
    if max_test_size is not None:
        test_size = min(test_size, max_test_size)

    folds: list[FoldInfo] = []
    for i in range(n_splits):
        train_end = test_size * (i + 1) + test_size
        train_size = train_end - test_size - gap
        if max_train_size is not None:
            train_size = min(train_size, max_train_size)
        train_size = max(train_size, 0)
        folds.append(FoldInfo(fold=i, train_size=train_size, valid_size=test_size))
    return folds
