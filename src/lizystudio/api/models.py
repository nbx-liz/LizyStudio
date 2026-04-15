"""Pydantic response models for OpenAPI schema generation (H-0043).

These models are used as ``response_model`` on FastAPI endpoints so that
openapi-typescript produces concrete TypeScript types instead of
``Record<string, unknown>``.

Models that may carry extra backend-specific fields use
``ConfigDict(extra="allow")`` to avoid validation errors while still
declaring the known fields.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

# --- Data ---


class DataRefResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    source_type: Literal["path", "upload"]
    path: str
    filename: str
    fingerprint: str
    shape: list[int]


class DataLoadResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    data_ref: DataRefResponse
    memory_usage_bytes: int


class ColumnInfoResponse(BaseModel):
    name: str
    dtype: str
    unique_count: int
    suggested_type: Literal["numeric", "categorical"]
    suggested_excluded: bool
    exclude_reason: Literal["id", "constant"] | None = None


class ColumnsResponseModel(BaseModel):
    target: str | None
    suggested_task: Literal["binary", "multiclass", "regression"] | None = None
    columns: list[ColumnInfoResponse]


class PreviewResponseModel(BaseModel):
    columns: list[str]
    data: list[dict[str, Any]]
    total_rows: int
    total_cols: int


class ValueCountResponse(BaseModel):
    value: str
    count: int


class ColumnStatsResponse(BaseModel):
    name: str
    dtype: str
    unique_count: int
    total_count: int
    null_count: int
    value_counts: list[ValueCountResponse]


class FoldInfoResponse(BaseModel):
    fold: int
    train_size: int
    valid_size: int


class SplitPreviewResponseModel(BaseModel):
    strategy: str
    n_splits: int
    folds: list[FoldInfoResponse]


# --- Workspace status ---


class StatusDataRef(BaseModel):
    """Subset of DataRef returned by GET /status."""

    filename: str
    shape: list[int]


class WorkspaceStatusResponse(BaseModel):
    has_data: bool
    has_config: bool
    has_result: bool
    data_ref: StatusDataRef | None = None
    current_job_id: str | None = None


# --- Config ---


class ConfigUpdateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    config: dict[str, Any]
    errors: list[dict[str, Any]]
    saved: bool


class ConfigPatchResponse(BaseModel):
    config: dict[str, Any]


class ValidationResponse(BaseModel):
    valid: bool
    errors: list[dict[str, Any]]


# --- Jobs ---


class JobStartResponse(BaseModel):
    job_id: str


class JobSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    job_id: str
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    backend_name: str
    job_type: Literal["fit", "tune"]
    created_at: str
    completed_at: str | None = None
    error: str | None = None
    model_name: str | None = None
    primary_score: float | None = None
    # H-0062 lineage: null for root jobs, set for Re-tune / Resume children.
    parent_job_id: str | None = None


class JobDetailResponse(JobSummaryResponse):
    fit_result: dict[str, Any] | None = None
    tune_result: dict[str, Any] | None = None
    config: dict[str, Any] | None = None


class PlotResponseModel(BaseModel):
    plotly_json: str


# --- Backends ---


class BackendInfoResponse(BaseModel):
    name: str
    version: str
