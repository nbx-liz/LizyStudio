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
 *    - The generated schema marks fields as optional (`?`) but the frontend
 *      expects them as required with `null` (e.g. `JobSummary.error`).
 *    - The generated schema lacks the type entirely (endpoint has no
 *      `response_model`, or it's a frontend-only / WebSocket type).
 *    - The shape differs (e.g. `shape: [number, number]` vs `number[]`).
 *
 * Backend Pydantic models now use `Literal[...]` annotations for enum-like
 * fields. `ColumnInfo` and `ColumnsResponse` are re-exported from the
 * generated schema. `JobSummary` remains hand-written due to optional vs
 * required field differences.
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

// --- Job types — hand-written because generated schema marks optional fields
// with `?` (e.g. `error?: string | null`) while frontend expects them as
// required with `null` default. Literal unions now match the generated schema. ---

export interface JobSummary {
  job_id: string;
  job_type: "fit" | "tune";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  backend_name: string;
  model_name: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  primary_score: number | null;
}

export interface JobDetail extends JobSummary {
  config: Record<string, unknown>;
  data_ref: DataRef;
  fit_result: FitResult | null;
  tune_result: TuneResult | null;
  model_path: string | null;
}

export interface FitResultParam {
  parameter: string;
  value: unknown;
}

export interface FitResult {
  metrics: Record<string, unknown>;
  fold_count: number;
  params: FitResultParam[];
}

export interface TuneResult {
  best_params: Record<string, unknown>;
  best_score: number;
  trials: Record<string, unknown>[];
  metric_name: string;
  direction: string;
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

export type FoldResult = {
  fold: number;
  metric: string;
  score: number;
};

export type TrialResult = {
  number: number;
  score: number | null;
  state: string;
  best_score: number | null;
};

export type ProgressMessage = {
  type: "progress";
  current: number;
  total: number;
  message?: string;
  elapsed?: number;
  metrics?: Record<string, unknown>;
  fold_results?: FoldResult[];
  trial_results?: TrialResult[];
};

export type CompletedMessage = {
  type: "completed";
  job_id: string;
};

export type ErrorMessage = {
  type: "error";
  message: string;
};

export type WsMessage = ProgressMessage | CompletedMessage | ErrorMessage;

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
