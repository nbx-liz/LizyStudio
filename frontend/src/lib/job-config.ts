/**
 * Typed accessors for the job config (docs/coupling-analysis.md B-10).
 *
 * The backend stores ``Job.config`` as a free-form ``dict[str, Any]``
 * because the shape is backend-specific (LizyML's Pydantic schema is
 * the source of truth, but LizyStudio only sees the serialised dict).
 * Without accessors every consumer reached into the dict with its own
 * ``(config.xxx as Record<string, unknown>)`` cast chain, which drifts
 * and hides typos.
 *
 * Every helper here:
 * - accepts a ``JobDetail`` (or ``undefined``/``null`` where noted),
 * - returns ``undefined`` / empty when the section is absent, and
 * - keeps the raw ``Record<string, unknown>`` shape so callers can
 *   still index into it for fields we do not model individually.
 */

import type { JobDetail } from "@/api/types";

// ---------------------------------------------------------------------------
// Section accessors
// ---------------------------------------------------------------------------

/**
 * Return a top-level section from ``job.config`` narrowed to a
 * ``Record<string, unknown>``.  Returns ``undefined`` when the job is
 * missing, the config is missing, or the section is not an object.
 */
export function getConfigSection(
  job: JobDetail | null | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const config = job?.config;
  if (!config) return undefined;
  const value = config[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** ``config.model`` section, empty object when absent. */
export function getModelSection(
  job: JobDetail | null | undefined,
): Record<string, unknown> {
  return getConfigSection(job, "model") ?? {};
}

/** ``config.model.params``, empty object when absent. */
export function getModelParams(
  job: JobDetail | null | undefined,
): Record<string, unknown> {
  const model = getModelSection(job);
  const params = model.params;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    return params as Record<string, unknown>;
  }
  return {};
}

/** ``config.evaluation`` section, empty object when absent. */
export function getEvaluationSection(
  job: JobDetail | null | undefined,
): Record<string, unknown> {
  return getConfigSection(job, "evaluation") ?? {};
}

/** ``config.data`` section, empty object when absent. */
export function getDataSection(
  job: JobDetail | null | undefined,
): Record<string, unknown> {
  return getConfigSection(job, "data") ?? {};
}

// ---------------------------------------------------------------------------
// Scalar accessors
// ---------------------------------------------------------------------------

/**
 * ``config.model.name`` as a string; empty string when absent or not a
 * string. Chosen as empty-string rather than ``undefined`` to match
 * what the backend ``_job_summary`` helper emits for ``model_name``
 * (H-0071), so call sites can treat both fields interchangeably.
 */
export function getModelName(job: JobDetail | null | undefined): string {
  const name = getModelSection(job).name;
  return typeof name === "string" ? name : "";
}

/**
 * ``config.data.target`` as a string; empty string when absent or not
 * a string. Used by the Inference flow to detect whether ground truth
 * is available in the uploaded dataset.
 */
export function getTargetColumn(job: JobDetail | null | undefined): string {
  const target = getDataSection(job).target;
  return typeof target === "string" ? target : "";
}

// ---------------------------------------------------------------------------
// Re-tune helpers (pre-B-10)
// ---------------------------------------------------------------------------

/** Default n_trials value shown in the Re-tune dialog. */
const DEFAULT_N_TRIALS = 50;

/**
 * Pick a sensible default ``n_trials`` for the Re-tune dialog based on
 * the parent job's original tuning config. Falls back to 50 when the
 * config is missing or malformed.
 */
export function defaultRetuneTrials(job: JobDetail): number {
  const raw = _pokeOptunaParam(job, "n_trials");
  return typeof raw === "number" && raw > 0 ? raw : DEFAULT_N_TRIALS;
}

function _pokeOptunaParam(job: JobDetail, key: string): unknown {
  const tuning = getConfigSection(job, "tuning");
  const optuna = tuning?.optuna;
  if (!optuna || typeof optuna !== "object" || Array.isArray(optuna)) {
    return undefined;
  }
  const params = (optuna as Record<string, unknown>).params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  return (params as Record<string, unknown>)[key];
}

/**
 * Pick the Resume dialog's pre-filled ``n_trials`` for a FAILED tune
 * job. Equals ``defaultRetuneTrials`` minus the number of completed
 * trials already on disk, with a floor of 1. Used by ResultsPanel
 * (Workspace) and JobDetail (Jobs page) — historically they each had
 * a private ``_computeRemainingTrials`` helper that drifted.
 */
export function remainingRetuneTrials(job: JobDetail): number {
  const original = defaultRetuneTrials(job);
  const tuneResult = job.tune_result as
    | { trials?: unknown[] | null }
    | null
    | undefined;
  const completed = Array.isArray(tuneResult?.trials)
    ? (tuneResult?.trials?.length ?? 0)
    : 0;
  return Math.max(1, original - completed);
}
