/**
 * Frontend types derived from BLUEPRINT and backend API responses.
 *
 * NOTE (H-0043 / v3-5): These types are hand-written because the backend
 * FastAPI endpoints do not yet declare `response_model`, so the auto-generated
 * `generated/schema.d.ts` has all responses typed as `{[key: string]: unknown}`.
 *
 * Once the backend adds Pydantic response models to each endpoint, these
 * hand-written types should be replaced by re-exports from the generated schema.
 * See PLAN.md Phase v3-5 for the full migration plan.
 *
 * In the meantime, a CI check (`pnpm check:api-types`) ensures the generated
 * schema stays in sync with the backend OpenAPI spec.
 */

export interface DataRef {
  source_type: "path" | "upload";
  path: string;
  filename: string;
  fingerprint: string;
  shape: [number, number];
}

export interface WorkspaceStatus {
  has_data: boolean;
  has_config: boolean;
  has_result: boolean;
  data_ref: { filename: string; shape: [number, number] } | null;
  current_job_id: string | null;
}

export interface ColumnInfo {
  name: string;
  dtype: string;
  unique_count: number;
  suggested_type: "numeric" | "categorical";
  suggested_excluded: boolean;
  exclude_reason: "id" | "constant" | null;
}

export interface ColumnsResponse {
  target: string | null;
  suggested_task: string | null;
  columns: ColumnInfo[];
}

export interface PreviewResponse {
  columns: string[];
  data: Record<string, unknown>[];
}

export interface ConfigUpdateResponse {
  config: Record<string, unknown>;
  errors: ConfigError[];
}

export interface ConfigError {
  path: string;
  message: string;
}

export interface BackendInfo {
  name: string;
  version: string;
}

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

export interface FitResult {
  metrics: Record<string, unknown>;
  fold_count: number;
  params: Record<string, unknown>[];
}

export interface TuneResult {
  best_params: Record<string, unknown>;
  best_score: number;
  trials: Record<string, unknown>[];
  metric_name: string;
  direction: string;
}

export interface ImportanceResponse {
  [feature: string]: number;
}

export interface PlotResponse {
  plotly_json: string;
}

export interface SplitSummaryRow {
  fold: number;
  [metric: string]: unknown;
}

export type FoldResult = {
  fold: number;
  metric: string;
  score: number;
};

export type ProgressMessage = {
  type: "progress";
  current: number;
  total: number;
  message?: string;
  elapsed?: number;
  metrics?: Record<string, unknown>;
  fold_results?: FoldResult[];
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
