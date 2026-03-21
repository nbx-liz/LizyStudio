/** Frontend types derived from BLUEPRINT and backend API responses. */

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
  data_ref: DataRef | null;
  current_job_id: string | null;
  backend_name: string;
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
  config: Record<string, unknown>;
  data_ref: DataRef;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface JobDetail extends JobSummary {
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

export type ProgressMessage = {
  type: "progress";
  current: number;
  total: number;
  message?: string;
  elapsed?: number;
  metrics?: Record<string, unknown>;
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

// --- UI Schema (H-0026) ---

export interface ParameterHint {
  key: string;
  label: string;
  kind: string;
  step?: number;
}

export interface SearchSpaceCatalogEntry {
  key: string;
  title: string;
  paramType: string;
  modes: string[];
  group?: string;
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
  };
  calibration_methods?: string[];
  additional_params?: string[];
}
