/**
 * Inference family queries — Phase 2 of B-7.
 *
 * All hooks mirror the pre-refactor inline ``useQuery`` bodies 1:1,
 * including the ``enabled`` semantics each caller already relied on
 * (so migration is byte-equivalent). Nullable arg types match the
 * factory signatures in ``queryKeys.ts``.
 */

import { useQuery } from "@tanstack/react-query";
import {
  type ComparisonStats,
  fetchInferenceComparison,
  fetchInferenceHistory,
  fetchInferenceMetrics,
  fetchInferencePlot,
  fetchInferencePredictions,
  fetchInferenceRecord,
  fetchInferenceShapPlot,
  type InferenceRecord,
} from "@/api/inference";
import { queryKeys } from "../queryKeys";

// ---------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------

/** Inference history for a single job. Disabled when ``jobId`` is null. */
export function useInferenceHistory(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.infHistory(jobId),
    queryFn: () => fetchInferenceHistory(jobId ?? undefined),
    enabled: jobId != null,
  });
}

/** Single inference record. Disabled until both ids are known. */
export function useInferenceRecord(infId: string | null, jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.infRecord(infId, jobId),
    queryFn: () => fetchInferenceRecord(infId as string, jobId as string),
    enabled: infId != null && jobId != null,
  });
}

/** Paged predictions table. */
export function useInferencePredictions(
  infId: string,
  jobId: string,
  page: number,
) {
  return useQuery({
    queryKey: queryKeys.infPredictions(infId, jobId, page),
    queryFn: () => fetchInferencePredictions(infId, jobId, 50, page * 50),
  });
}

/** Metrics for an inference record (ground-truth scenario only). */
export function useInferenceMetrics(
  infId: string,
  jobId: string,
): ReturnType<typeof useQuery<Record<string, unknown>>> {
  return useQuery({
    queryKey: queryKeys.infMetrics(infId, jobId),
    queryFn: () => fetchInferenceMetrics(infId, jobId),
  });
}

/** Plot for an inference record. Pass ``enabled: false`` while the
 * user hasn't picked a plot type yet (mirrors the pre-refactor gate).
 * ``retry`` defaults to TanStack's default but consumers can disable
 * it for plots where a 404 means "not available for this task type".
 */
export function useInferencePlot(
  infId: string,
  jobId: string,
  plotType: string,
  options?: { enabled?: boolean; retry?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.infPlot(infId, jobId, plotType),
    queryFn: () => fetchInferencePlot(infId, jobId, plotType),
    enabled: options?.enabled !== false,
    retry: options?.retry,
  });
}

/** SHAP summary plot.
 *
 * Issue #355: callers MUST pass ``enabled: false`` when the backend
 * does not advertise SHAP in its available-plots list, otherwise the
 * unconditional fetch produces a 500/404 in the browser console on
 * every Inference run. ``enabled`` defaults to ``true`` for callers
 * that already know the plot is supported.
 *
 * ``retry: false`` remains the recommended setting: a missing SHAP
 * plot is "no SHAP for this job", not a transient failure.
 */
export function useInferenceShap(
  infId: string,
  jobId: string,
  options?: { retry?: boolean; enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.infShap(infId, jobId),
    queryFn: () => fetchInferenceShapPlot(infId, jobId),
    retry: options?.retry,
    enabled: options?.enabled,
  });
}

/** Comparison between two inference records. Disabled until
 * ``compareInfId`` is picked.
 */
export function useInferenceComparison(
  infId: string,
  compareInfId: string | null,
  jobId: string,
) {
  return useQuery({
    queryKey: queryKeys.infComparison(infId, compareInfId, jobId),
    queryFn: () =>
      fetchInferenceComparison(infId, compareInfId as string, jobId),
    enabled: !!compareInfId,
  });
}

// Re-export the record types so consumers don't have to import both
// from `@/api/inference` and `@/api/queries`.
export type { ComparisonStats, InferenceRecord };
