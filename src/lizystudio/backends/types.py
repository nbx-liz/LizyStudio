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
    """Hyperparameter tuning result summary."""

    best_params: dict[str, Any]
    best_score: float
    trials: list[dict[str, Any]]  # Trial history (list of rows)
    metric_name: str
    direction: str  # "minimize" | "maximize"


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
    columns: list[ColumnInfo] = field(default_factory=list)
