"""Common types shared between Service and API layers.

Backend-specific types (e.g. lizyml.FitResult) must NOT leak beyond
the Adapter boundary. These types are the only result types that
Service / Router code may reference.

Most entries are ``@dataclass`` (frozen where immutability matters).
The Tune-defaults trio (``TuningDefaults`` / ``TuningOverrides`` /
``TuningConfig``) uses Pydantic ``BaseModel`` so the Pydantic-specific
``model_fields_set`` introspection can distinguish "user-set field"
from "default-derived field" at runtime — see P-0109 INV-T1 for the
intent/effective split.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Tune defaults trio (P-0109 PR-2) — kept at top of module so subsequent
# dataclasses can reference them via forward declaration if needed.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TuningDefaults:
    """Canonical Tune defaults derived from a backend's catalog (P-0109).

    Returned by :meth:`BackendCore.get_tuning_defaults`. Represents what
    the catalog would propose if the user customised nothing — *not*
    the effective tune config a job runs with (that's
    :class:`TuningConfig`, the merge of these defaults with
    :class:`TuningOverrides`).

    Pure, immutable, task-keyed: ``adapter.get_tuning_defaults("binary")``
    and ``adapter.get_tuning_defaults("regression")`` may differ. A
    minimal backend (no Optuna catalog) returns ``TuningDefaults()``.

    INV-T5 (P-0109): each backend adapter is the single source of truth
    for its own defaults. Frontend has no adapter-specific branches.
    """

    space: dict[str, dict[str, Any]] = field(default_factory=dict)
    """Catalog-derived search-space entries keyed by parameter name.
    Each entry is the SpaceEntry dict shape
    ``{"type": ..., "low": ..., "high": ..., "log": ..., ...}`` that
    the backend's parser accepts. Empty when the backend declares no
    catalog ranges."""

    evaluation_metrics: list[Any] = field(default_factory=list)
    """Canonical evaluation metrics for the task, e.g.
    ``["auc", "auc_pr", "brier", "logloss"]`` for lizyml binary.
    Empty when the backend has no canonical default set."""

    direction: Literal["maximize", "minimize"] | None = None
    """Optimisation direction implied by ``evaluation_metrics[0]`` under
    the backend's metric registry. ``None`` when ``evaluation_metrics``
    is empty or no canonical direction exists for the task."""


class TuningOverrides(BaseModel):
    """User-set Tune customisations — sparse intent (P-0109).

    Persisted in the LizyStudio workspace config as the sole record of
    "what the user changed". All fields are optional so the absence of a
    value means "use the catalog default" rather than "set this to
    ``None``". Use :meth:`pydantic.BaseModel.model_fields_set` to
    distinguish ``user explicitly set timeout=None`` (no-timeout intent)
    from ``user has not touched timeout`` (the field is omitted from
    ``model_fields_set``).

    INV-T1 / INV-T2 (P-0109): overrides are task-agnostic. Task
    transitions never mutate overrides; the *effective* config is
    re-computed from new catalog + same overrides.

    ``frozen=True``: an overrides instance is immutable post-construction
    so callers receive defensive snapshots when reading from the
    workspace state.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    n_trials: int | None = None
    timeout: int | None = None
    direction: Literal["maximize", "minimize"] | None = None
    space: dict[str, dict[str, Any]] = Field(default_factory=dict)
    """Per-key overrides. A key absent from this dict falls back to the
    matching ``TuningDefaults.space[key]`` (or is simply absent in
    effective if the catalog also has nothing). A key present here wins
    outright over any catalog default for the same key."""

    evaluation_metrics: list[Any] | None = None


class TuningConfig(BaseModel):
    """Effective Tune configuration — catalog defaults merged with overrides
    (P-0109).

    Computed on demand by
    :meth:`BackendCore.compute_effective_tuning`. Never persisted in
    the workspace; captured into ``job.config.tuning`` when a tune job
    starts (INV-T6 P-0109: reproducibility — a job's effective config
    must remain stable even as the catalog evolves).

    All fields are required: effective state is complete by
    construction. ``user_set_paths`` carries provenance so the UI can
    render a "modified" badge per row / field.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    n_trials: int
    timeout: int | None
    direction: Literal["maximize", "minimize"]
    space: dict[str, dict[str, Any]]
    evaluation_metrics: list[Any]
    user_set_paths: list[str] = Field(default_factory=list)
    """Dot-path identifiers of fields whose value came from
    ``TuningOverrides`` (not from ``TuningDefaults``). Examples:
    ``"n_trials"``, ``"timeout"``, ``"direction"``,
    ``"space.learning_rate"``, ``"evaluation_metrics"``. Per-key
    granularity for ``space`` (catalog vs override at the row level);
    list-level for ``evaluation_metrics`` (overrides replace the whole
    list when present)."""


@dataclass
class BackendInfo:
    """Backend identification."""

    name: str  # "lizyml", ...
    version: str


@dataclass
class ConfigSchema:
    """Config JSON Schema for frontend form generation."""

    json_schema: dict[str, Any]


@dataclass(frozen=True)
class IncompatibleMetric:
    """Advisory entry for a configured metric whose preconditions the
    loaded target column violates (e.g. MAPE on a target containing zeros).

    Returned by :meth:`BackendCore.get_incompatible_metrics`. The
    ``suggested_fix`` string may reference backend-specific replacements
    (e.g. lizyml's sMAPE / WAPE for MAPE). The Service layer wraps each
    entry in its ``severity="warning"`` validation envelope; it does not
    block Fit.
    """

    metric: str
    message: str
    suggested_fix: str


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
    #         position_pct, edge, expanded, new_low, new_high,
    #         clamped_to_bound),
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
