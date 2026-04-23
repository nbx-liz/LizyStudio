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


class FitResultResponse(BaseModel):
    """Training result summary (mirror of :class:`FitSummary`).

    ``metrics`` is a backend-dependent nested mapping (e.g. LizyML emits
    ``{"raw": {"oof": {...}}, "formatted": [...]}``). ``extra='allow'``
    keeps forward-compatibility for additional backend-specific keys.
    """

    model_config = ConfigDict(extra="allow")

    metrics: dict[str, Any]
    fold_count: int
    params: list[dict[str, Any]]


class TuneResultResponse(BaseModel):
    """Hyperparameter tuning summary (mirror of :class:`TuningSummary`).

    The multi-round re-tune path (H-0061) populates ``rounds`` and
    ``boundary_report``; legacy single-round tuning leaves them ``None``.
    """

    model_config = ConfigDict(extra="allow")

    best_params: dict[str, Any]
    best_score: float
    trials: list[dict[str, Any]]
    metric_name: str
    direction: str
    rounds: list[dict[str, Any]] | None = None
    boundary_report: dict[str, Any] | None = None


class JobSummaryResponse(BaseModel):
    """Metadata row returned by ``GET /api/jobs``.

    All optional fields are declared ``X | None = None`` (required with a
    null default) so generated TypeScript types expose them as
    ``key: T | null`` rather than ``key?: T | null``, matching the actual
    response shape — :func:`_job_summary` always populates every key.
    """

    job_id: str
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    backend_name: str
    job_type: Literal["fit", "tune"]
    created_at: str
    completed_at: str | None = None
    error: str | None = None
    model_name: str = ""
    primary_score: float | None = None
    # H-0062 lineage: null for root jobs, set for Re-tune / Resume children.
    parent_job_id: str | None = None


class JobDetailResponse(JobSummaryResponse):
    """Full job payload returned by ``GET /api/jobs/{job_id}``.

    ``fit_result`` / ``tune_result`` use concrete Pydantic models so the
    generated TS types declare ``metrics``, ``fold_count``, ``best_params``
    etc. instead of :code:`Record<string, unknown>`.
    """

    config: dict[str, Any] | None = None
    fit_result: FitResultResponse | None = None
    tune_result: TuneResultResponse | None = None


class PlotResponseModel(BaseModel):
    plotly_json: str


# --- Job lifecycle / actions (H-0085, Issue #236) ---


class JobLogResponse(BaseModel):
    """GET /api/jobs/{job_id}/log."""

    log: str


class CancelJobResponse(BaseModel):
    """POST /api/jobs/{job_id}/cancel."""

    status: str


class DeleteJobResponse(BaseModel):
    """DELETE /api/jobs/{job_id}."""

    status: str
    # Present when cascade=true was passed; plain delete returns the target id.
    removed_job_ids: list[str] | None = None


class ExportJobResponse(BaseModel):
    """POST /api/jobs/{job_id}/export."""

    exported_path: str
    export_type: str


class ExportCodeResponse(BaseModel):
    """GET /api/jobs/{job_id}/export-code."""

    code: str
    filename: str


class RetuneJobResponse(BaseModel):
    """POST /api/jobs/{job_id}/retune and /resume.

    Both endpoints return the child job id and its parent reference.
    """

    job_id: str
    parent_job_id: str


class LineageNodeResponse(BaseModel):
    """Node in the lineage tree (H-0062). Self-referential — children
    are declared via ``model_rebuild`` below because BaseModel forward-
    references within the same module need an explicit rebuild call in
    Python versions pydantic targets."""

    job_id: str
    status: str
    job_type: str
    # Concrete type resolved after class body (see ``model_rebuild`` call).
    children: list[LineageNodeResponse]
    truncated: bool | None = None


LineageNodeResponse.model_rebuild()


class LineageResponse(BaseModel):
    """GET /api/jobs/{job_id}/lineage."""

    tree: LineageNodeResponse


# --- Backends ---


class BackendInfoResponse(BaseModel):
    name: str
    version: str


# --- Inference (C-2) ---


class InferenceRunResponse(BaseModel):
    """Response from ``POST /api/inference/run``."""

    inf_id: str
    job_id: str


class InferenceUploadResponse(BaseModel):
    """Response from ``POST /api/inference/upload``."""

    upload_path: str
    filename: str


class InferenceDataRefResponse(BaseModel):
    """DataRef embedded inside :class:`InferenceRecordResponse`.

    Uses ``extra='allow'`` so fields like ``mtime`` that the backend
    may record on uploads still round-trip without validation errors.
    """

    model_config = ConfigDict(extra="allow")

    source_type: Literal["path", "upload"]
    path: str
    filename: str
    fingerprint: str
    shape: list[int]


class InferenceRecordResponse(BaseModel):
    """Persisted inference record (history entry / GET by id)."""

    inf_id: str
    job_id: str
    data_ref: InferenceDataRefResponse
    has_ground_truth: bool
    created_at: str
    row_count: int
    warnings: list[str]


class PredictionsResponse(BaseModel):
    """Paginated predictions table returned by ``/predictions``."""

    columns: list[str]
    data: list[dict[str, Any]]
    total_rows: int


class InferenceMetricsResponse(BaseModel):
    """Inference metrics — regression vs. classification share one shape.

    The exact metric set is backend- and task-dependent. The known keys
    emitted by :func:`lizystudio.services.inference.evaluate_predictions`
    are declared here so the generated TypeScript type exposes concrete
    fields, while ``extra='allow'`` keeps forward-compatibility when a
    backend adds a new metric (e.g. ``f1`` for multiclass).  All fields
    are optional because no single task emits every one of them.
    """

    model_config = ConfigDict(extra="allow")

    # Regression
    mae: float | None = None
    rmse: float | None = None
    # Classification (binary / multiclass)
    accuracy: float | None = None
    auc: float | None = None
    logloss: float | None = None


class ComparisonGroupStats(BaseModel):
    """Summary statistics for one inference run in a comparison.

    Optional keys (``median`` for regression, ``positive_pct`` for
    binary classification) appear only when the task warrants them —
    ``extra='allow'`` lets them flow through without validation errors.
    """

    model_config = ConfigDict(extra="allow")

    mean: float
    std: float
    min: float
    max: float
    count: int


class ComparisonStatsResponse(BaseModel):
    """Response from ``GET /api/inference/{inf_id}/comparison/{other_inf_id}``."""

    model_config = ConfigDict(extra="allow")

    current: ComparisonGroupStats
    other: ComparisonGroupStats
    current_proba: ComparisonGroupStats | None = None
    other_proba: ComparisonGroupStats | None = None


# --- UI Schema (H-0026 / C-5) ---


class UiSection(BaseModel):
    """Top-level section in the config editor (Model / Training / ...)."""

    key: str
    title: str


class ParameterHintResponse(BaseModel):
    """Label/step/default metadata for a single config parameter.

    ``default`` is backend-dependent — scalar, list, or task-keyed dict —
    so it is typed as ``Any`` rather than narrowed.
    """

    model_config = ConfigDict(extra="allow")

    key: str
    label: str
    kind: str
    step: float | None = None
    default: Any | None = None
    description: str | None = None


class SearchSpaceRangeDefault(BaseModel):
    """Default ``range`` mode values for a tunable parameter."""

    low: float
    high: float
    log: bool


class SearchSpaceCatalogEntryResponse(BaseModel):
    """One entry in ``search_space_catalog`` — a tunable parameter.

    ``default``/``default_choices`` are heterogeneous (boolean, number,
    string) so they stay typed as ``Any``.
    """

    model_config = ConfigDict(extra="allow")

    key: str
    title: str
    paramType: str
    modes: list[str]
    group: str | None = None
    default: Any | None = None
    default_mode: Literal["fixed", "range", "choice"] | None = None
    default_range: SearchSpaceRangeDefault | None = None
    default_choices: list[Any] | None = None


class UiCapabilitiesTune(BaseModel):
    """Backend capability flags for the Tune tab."""

    allow_empty_space: bool


class UiCapabilities(BaseModel):
    """Backend-declared capabilities consumed by the Workspace UI."""

    model_config = ConfigDict(extra="allow")

    cv_strategies: list[str]
    tune: UiCapabilitiesTune
    cv_strategy_fields: dict[str, list[str]] | None = None
    cv_defaults: dict[str, Any] | None = None
    cv_default_strategy: dict[str, str] | None = None


class UiSchemaResponse(BaseModel):
    """Response from ``GET /api/backends/ui-schema`` (H-0026).

    Mirrors the dict produced by :func:`build_ui_schema` in
    ``backends/lizyml_ui_schema.py``. Frontend re-exports this type via
    the generated ``schema.d.ts`` so the 3-way drift between backend
    dict / OpenAPI / ``frontend/src/api/types.ts`` is eliminated (C-5).
    """

    model_config = ConfigDict(extra="allow")

    sections: list[UiSection]
    option_sets: dict[str, dict[str, list[str]]]
    metric_direction: dict[str, dict[str, str]] | None = None
    parameter_hints: list[ParameterHintResponse]
    search_space_catalog: list[SearchSpaceCatalogEntryResponse]
    step_map: dict[str, float]
    conditional_visibility: dict[str, dict[str, Any]]
    defaults: dict[str, dict[str, Any]]
    inner_valid_options: list[str]
    n_trials_presets: list[int] | None = None
    capabilities: UiCapabilities | None = None
    calibration_methods: list[str] | None = None
    additional_params: list[str] | None = None
    special_search_space_fields: dict[str, str] | None = None
