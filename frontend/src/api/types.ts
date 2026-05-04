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
  // P-0088 / Issue #256: backend's active ALLOWED_FILES_ROOT. Used by
  // the E2E globalSetup to fingerprint the server env; UI does not
  // render this field.
  files_root: string;
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
 *
 * `saved` is the backend's authoritative answer to "did this PUT
 * actually persist?" — false when validation rejected the body.
 * Callers must observe it (Issue #276); silently dropping it leads to
 * UI ↔ backend divergence.
 */
export interface ConfigUpdateResponse {
  config: Record<string, unknown>;
  errors: ConfigError[];
  saved: boolean;
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

// --- UI Schema (H-0026 / C-5) ---
//
// Re-exported from the generated schema. Backend Pydantic
// (`api/models.py::UiSchemaResponse`) is the SSOT — the 3-way drift
// between backend dict / OpenAPI / hand-written TS is eliminated.
// `ParameterHint` / `SearchSpaceCatalogEntry` keep their legacy names
// so existing consumers need not change their imports.

export type UiSchema = components["schemas"]["UiSchemaResponse"];
export type ParameterHint = components["schemas"]["ParameterHintResponse"];
export type SearchSpaceCatalogEntry =
  components["schemas"]["SearchSpaceCatalogEntryResponse"];
