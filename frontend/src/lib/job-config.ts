/**
 * Helpers for poking at the deeply-nested ``tuning.optuna.params``
 * section of a job config. Previously each Re-tune UI site duplicated
 * the same 5-level optional-chain (``config?.tuning?.optuna?.params?.
 * n_trials``), which B-2 in docs/coupling-analysis.md flagged as a
 * twin-helper drift hazard.
 */

import type { JobDetail } from "@/api/types";

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
  const config = job.config as Record<string, unknown> | undefined;
  const tuning = config?.tuning as Record<string, unknown> | undefined;
  const optuna = tuning?.optuna as Record<string, unknown> | undefined;
  const params = optuna?.params as Record<string, unknown> | undefined;
  return params?.[key];
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
