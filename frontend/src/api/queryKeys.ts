/**
 * Query key factory — single source of truth for TanStack Query cache keys.
 *
 * Centralizes the string keys that previously lived inline at 65+ call sites
 * so that:
 *   - typos cannot silently create a parallel cache entry,
 *   - adding a new query surface updates one file, not every caller,
 *   - invalidation patterns are discoverable by reading this file.
 *
 * Output is bit-identical to the pre-factory inline keys (e.g.
 * ``queryKeys.job(id)`` returns ``["job", id]``), so this PR does not
 * rename any existing cache namespace. A hierarchical rename is a
 * separate refactor if we want ``invalidateQueries(queryKeys.all)`` to
 * mass-clear everything.
 */

// ---------------------------------------------------------------------------
// Jobs family
// ---------------------------------------------------------------------------

export const queryKeys = {
  jobs: () => ["jobs"] as const,
  job: (jobId: string | null) => ["job", jobId] as const,
  jobDetail: (jobId: string | null) => ["job-detail", jobId] as const,
  jobLog: (jobId: string | null) => ["job-log", jobId] as const,
  jobLineage: (jobId: string) => ["job-lineage", jobId] as const,
  jobPlots: (jobId: string) => ["job-plots", jobId] as const,
  jobPlot: (jobId: string, plotType: string) =>
    ["job-plot", jobId, plotType] as const,
  jobPlotLearningCurve: (jobId: string, metric: string | null) =>
    ["job-plot", jobId, "learning-curve", metric] as const,
  jobPlotImportance: (jobId: string, kind: string) =>
    ["job-plot", jobId, "importance", kind] as const,
  jobPlotTuning: (jobId: string) => ["job-plot", jobId, "tuning"] as const,
  jobImportance: (jobId: string, kind: string) =>
    ["job-importance", jobId, kind] as const,
  jobImportanceKinds: (jobId: string) =>
    ["job-importance-kinds", jobId] as const,
  jobLearningCurveMetrics: (jobId: string) =>
    ["job-learning-curve-metrics", jobId] as const,
  jobSplitSummary: (jobId: string) => ["job-split-summary", jobId] as const,

  // ---------------------------------------------------------------------
  // Inference family
  //
  // ``infHistoryAll()`` intentionally matches the prefix of ``infHistory(id)``
  // so that ``invalidateQueries({ queryKey: queryKeys.infHistoryAll() })``
  // fans out to every per-job history cache via TanStack Query's prefix-
  // matching rule. Keep the first tuple element (``"inf-history"``) in sync
  // across the two helpers if either is renamed.
  // ---------------------------------------------------------------------
  infHistory: (jobId: string | null) => ["inf-history", jobId] as const,
  infHistoryAll: () => ["inf-history"] as const,
  infRecord: (infId: string | null, jobId: string | null) =>
    ["inf-record", infId, jobId] as const,
  infMetrics: (infId: string, jobId: string) =>
    ["inf-metrics", infId, jobId] as const,
  infPredictions: (infId: string, jobId: string, page: number) =>
    ["inf-predictions", infId, jobId, page] as const,
  infPlot: (infId: string, jobId: string, plotType: string) =>
    ["inf-plot", infId, jobId, plotType] as const,
  infShap: (infId: string, jobId: string) =>
    ["inf-shap", infId, jobId] as const,
  infComparison: (infId: string, compareInfId: string | null, jobId: string) =>
    ["inf-comparison", infId, compareInfId, jobId] as const,

  // ---------------------------------------------------------------------
  // Workspace / config family
  // ---------------------------------------------------------------------
  config: () => ["config"] as const,
  configSchema: () => ["config-schema"] as const,
  uiSchema: () => ["ui-schema"] as const,
  backends: () => ["backends"] as const,
  columns: () => ["columns"] as const,
  files: (path: string) => ["files", path] as const,
} as const;
