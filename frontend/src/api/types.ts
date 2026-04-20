/**
 * Frontend API types — hybrid approach.
 *
 * ## Pattern
 * 1. **Re-exported from generated schema** — types where the generated OpenAPI
 *    schema exactly matches (or is a safe superset of) what the frontend needs.
 *    These are imported from `./generated/schema` and re-exported with friendly
 *    names so consumers keep importing from `@/api/types`.
 *
 * 2. **Hand-written** — types where:
 *    - The generated schema lacks the type entirely (endpoint has no
 *      `response_model`, or it's a frontend-only / WebSocket type).
 *    - The shape differs (e.g. `shape: [number, number]` vs `number[]`).
 *
 * Backend Pydantic models now use `Literal[...]` annotations for enum-like
 * fields and `JobSummaryResponse` / `JobDetailResponse` / `FitResultResponse`
 * / `TuneResultResponse` have been strengthened so this file re-exports them
 * directly (C-4, docs/coupling-analysis.md).
 */

import type { components } from "./generated/schema";

// ---------------------------------------------------------------------------
// Re-exported generated types (1:1 match)
// ---------------------------------------------------------------------------

/** GET /api/backends */
export type BackendInfo = components["schemas"]["BackendInfoResponse"];

/** GET /api/workspace/data/split-preview */
export type FoldInfo = components["schemas"]["FoldInfoResponse"];

/** GET /api/jobs/:id/plot/:kind */
export type PlotResponse = components["schemas"]["PlotResponseModel"];

/** GET /api/workspace/data/preview */
export type PreviewResponse = components["schemas"]["PreviewResponseModel"];

/** GET /api/workspace/data/split-preview */
export type SplitPreviewResponse =
  components["schemas"]["SplitPreviewResponseModel"];

// ---------------------------------------------------------------------------
// Hand-written types — generated schema uses `string` where we need literals,
// or the type is absent from the schema entirely.
// ---------------------------------------------------------------------------

/**
 * DataRef — hand-written because generated `DataRefResponse` types
 * `shape` as `number[]` instead of the stricter `[number, number]`.
 * `source_type` now matches the generated Literal union.
 */
export interface DataRef {
  source_type: "path" | "upload";
  path: string;
  filename: string;
  fingerprint: string;
  shape: [number, number];
}

/**
 * WorkspaceStatus — hand-written because the generated
 * `WorkspaceStatusResponse` references `StatusDataRef` with `shape: number[]`
 * instead of `[number, number]`.
 */
export interface WorkspaceStatus {
  has_data: boolean;
  has_config: boolean;
  has_result: boolean;
  data_ref: { filename: string; shape: [number, number] } | null;
  current_job_id: string | null;
}

/**
 * ColumnInfo — re-exported from generated schema.
 * Backend Pydantic models now use `Literal` for `suggested_type` and
 * `exclude_reason`, so the generated type has proper literal unions.
 */
export type ColumnInfo = components["schemas"]["ColumnInfoResponse"];

/** GET /api/workspace/data/columns */
export type ColumnsResponse = components["schemas"]["ColumnsResponseModel"];

/**
 * ConfigUpdateResponse — hand-written because generated type has
 * `errors: {[key: string]: unknown}[]` whereas we use the structured
 * `ConfigError` type, and the generated type includes an index signature.
 */
export interface ConfigUpdateResponse {
  config: Record<string, unknown>;
  errors: ConfigError[];
}

export interface ConfigError {
  path: string;
  message: string;
}

// --- Job types — re-exported from the generated schema (C-4).
//
// Backend Pydantic models (``api/models.py``) are the SSOT:
// - JobSummaryResponse / JobDetailResponse no longer use ``extra='allow'``
//   so the generated shape is strict.
// - FitResult / TuneResult have concrete Pydantic sub-models so consumers
//   see ``metrics`` / ``fold_count`` / ``best_params`` etc. instead of
//   ``Record<string, unknown>``.
//
// ``H-0062 parent_job_id`` is always present in the API response so callers
// rely on ``job.parent_job_id === null`` (not ``undefined``). The Pydantic
// field is ``str | None = None`` which generates ``?: string | null``; we
// treat an absent key as a backend bug rather than a valid state.

export type JobSummary = components["schemas"]["JobSummaryResponse"];
export type JobDetail = components["schemas"]["JobDetailResponse"];
export type FitResult = components["schemas"]["FitResultResponse"];
export type TuneResult = components["schemas"]["TuneResultResponse"];

export interface FitResultParam {
  parameter: string;
  value: unknown;
}

// --- Types absent from the generated schema ---

export interface ValueCount {
  value: string;
  count: number;
}

export interface ColumnStatsResponse {
  name: string;
  dtype: string;
  unique_count: number;
  total_count: number;
  null_count: number;
  value_counts: ValueCount[];
}

export interface ImportanceResponse {
  [feature: string]: number;
}

export interface SplitSummaryRow {
  fold: number;
  [metric: string]: unknown;
}

// ---------------------------------------------------------------------------
// Frontend-only types (WebSocket messages, UI helpers)
// ---------------------------------------------------------------------------

// H-0069: FoldResult / TrialResult re-exported from the generated
// schema so they stay in sync with the Pydantic SSOT in
// ``src/lizystudio/ws/messages.py``.  Metric names vary by task
// (rmse/r2 for regression, auc/logloss for classification) — the
// backend declares only the invariant fields and ``extra='allow'``
// keeps optional metric keys flowing through.
export type FoldResult = components["schemas"]["WsFoldResult"];
export type TrialResult = components["schemas"]["WsTrialResult"];

// --- WebSocket messages (H-0069 SSOT) ---
//
// These mirror the Pydantic discriminated union in
// ``src/lizystudio/ws/messages.py``. Types are generated from the
// backend OpenAPI schema by ``openapi-typescript`` and re-exported
// here so existing imports keep working.  Do NOT redeclare the shape
// — edit ``ws/messages.py`` and run ``pnpm generate:api``.

export type ProgressMessage = components["schemas"]["WsProgress"];
export type CompletedMessage = components["schemas"]["WsCompleted"];
export type ErrorMessage = components["schemas"]["WsError"];
export type PingMessage = components["schemas"]["WsPing"];
export type WsMessage = components["schemas"]["WsMessage"];

// --- MetricEntry (H-0034) ---

/** Metric parameter values — always numeric, string, or boolean. */
export type MetricParamValues = Record<string, number | string | boolean>;

/**
 * A metric entry is either a plain name ("auc") or a parameterised dict
 * ({"precision_at_k": {"k": 20}}).
 */
export type MetricEntry = string | Record<string, MetricParamValues>;

/**
 * Extract the metric name from a MetricEntry.
 * Throws if the entry is an empty object (should never happen with valid data).
 */
export function metricEntryName(entry: MetricEntry): string {
  if (typeof entry === "string") return entry;
  const key = Object.keys(entry)[0];
  if (!key) throw new Error("MetricEntry object must have exactly one key");
  return key;
}

// --- UI Schema (H-0026) ---

export interface ParameterHint {
  key: string;
  label: string;
  kind: string;
  step?: number;
  default?: unknown;
  description?: string;
}

export interface SearchSpaceCatalogEntry {
  key: string;
  title: string;
  paramType: string;
  modes: string[];
  group?: string;
  default?: unknown;
  /** Initial mode for the parameter: "fixed" (default), "range", or "choice". */
  default_mode?: "fixed" | "range" | "choice";
  /** Default range values when switching to range mode. */
  default_range?: { low: number; high: number; log: boolean };
  /** Default choices when switching to choice mode. */
  default_choices?: (string | number)[];
}

export interface UiSchema {
  sections: { key: string; title: string }[];
  option_sets: Record<string, Record<string, string[]>>;
  metric_direction?: Record<string, Record<string, string>>;
  parameter_hints: ParameterHint[];
  search_space_catalog: SearchSpaceCatalogEntry[];
  step_map: Record<string, number>;
  conditional_visibility: Record<string, Record<string, unknown>>;
  defaults: Record<string, Record<string, unknown>>;
  inner_valid_options: string[];
  n_trials_presets?: number[];
  capabilities?: {
    cv_strategies: string[];
    tune: { allow_empty_space: boolean };
    cv_strategy_fields?: Record<string, string[]>;
    cv_defaults?: Record<string, unknown>;
    cv_default_strategy?: Record<string, string>;
  };
  calibration_methods?: string[];
  additional_params?: string[];
  special_search_space_fields?: Record<string, string>;
}
