"""Common types shared between Service and API layers.

Backend-specific types (e.g. lizyml.FitResult) must NOT leak beyond
the Adapter boundary. These dataclasses are the only result types that
Service / Router code may reference.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd


@dataclass
class BackendInfo:
    """Backend identification."""

    name: str  # "lizyml", ...
    version: str


@dataclass
class ConfigSchema:
    """Config JSON Schema for frontend form generation."""

    json_schema: dict[str, Any]


@dataclass
class FitSummary:
    """Training result summary."""

    metrics: dict[str, Any]  # Nested metric structure (backend-dependent)
    fold_count: int
    params: list[dict[str, Any]]  # Parameter table (list of rows)


@dataclass
class TuningSummary:
    """Hyperparameter tuning result summary.

    The optional ``rounds`` and ``boundary_report`` fields are populated
    when tuning is executed via the multi-round re-tune path (H-0061);
    legacy single-round tuning leaves them as ``None``.
    """

    best_params: dict[str, Any]
    best_score: float
    trials: list[dict[str, Any]]  # Trial history (list of rows)
    metric_name: str
    direction: str  # "minimize" | "maximize"
    # Per-round summaries. Each entry contains at least:
    #   round (1-indexed int), n_trials (int),
    #   best_score_before (float | None), best_score_after (float),
    #   expanded_dims (list[str]), space_snapshot (dict[str, Any]).
    rounds: list[dict[str, Any]] | None = None
    # Final-round BoundaryReport. Keys:
    #   dims: list of per-dim status (name, best_value, low, high,
    #         position_pct, edge, expanded, new_low, new_high),
    #   expanded_names: list[str].
    boundary_report: dict[str, Any] | None = None


@dataclass
class PredictionSummary:
    """Inference result summary."""

    predictions: pd.DataFrame  # Prediction table (idx, pred, proba, actual, ...)
    warnings: list[str]


@dataclass
class PlotData:
    """Plotly figure as JSON string."""

    plotly_json: str  # fig.to_json()


@dataclass
class DataRef:
    """Reference to a loaded dataset (no data copy)."""

    source_type: Literal["path", "upload"]
    path: str  # Local path or upload temp path
    filename: str  # Original file name
    fingerprint: str  # Hash for reproducibility tracking
    shape: tuple[int, int]  # (rows, cols)


@dataclass
class ColumnInfo:
    """Per-column metadata returned by column analysis."""

    name: str
    dtype: str
    unique_count: int
    suggested_type: Literal["numeric", "categorical"]
    suggested_excluded: bool
    exclude_reason: Literal["id", "constant"] | None = None


@dataclass
class ColumnsResponse:
    """Response for GET /api/workspace/data/columns."""

    target: str | None
    suggested_task: Literal["binary", "multiclass", "regression"] | None = None
    columns: list[ColumnInfo] = field(default_factory=list)


@dataclass
class FoldInfo:
    """Per-fold size information for split preview."""

    fold: int
    train_size: int
    valid_size: int


@dataclass
class SplitPreview:
    """Predicted fold sizes for a CV split strategy (no sklearn needed)."""

    strategy: str
    n_splits: int
    folds: list[FoldInfo] = field(default_factory=list)
