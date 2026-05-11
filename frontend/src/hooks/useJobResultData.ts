/**
 * Shared data-fetching hook for the "completed job" results panel.
 *
 * Previously ResultsCompletedView (Workspace) and CompletedContent (Jobs)
 * each owned 8 near-identical useQuery blocks plus the derived state
 * (lcMetric / importanceKind auto-init, metric parsing, annotation).
 * That duplication already drifted — the Jobs page parsed LC metrics
 * from ``config.model.params.metric`` while Workspace hit the
 * ``/api/jobs/{id}/learning-curve-metrics`` endpoint.
 *
 * This hook collapses the two into one source of truth and standardises
 * on the backend endpoint for LC metrics. The two consumers now differ
 * only in presentation chrome (header/lineage on Workspace, ScoreSection
 * accordion on Jobs).
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  fetchJobImportance,
  fetchJobImportanceKinds,
  fetchJobLearningCurveMetrics,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
} from "@/api/jobs";
import { queryKeys } from "@/api/queryKeys";
import type {
  ImportanceResponse,
  JobDetail,
  MetricEntry,
  PlotResponse,
  SplitSummaryRow,
} from "@/api/types";
import { getEvaluationSection } from "@/lib/job-config";
import { pivotMetrics } from "@/lib/metrics";

export interface UseJobResultDataParams {
  job: JobDetail;
  selectedPlot: string;
}

export interface UseJobResultData {
  /** Server-reported list of available plot types for this job. */
  plots: string[] | undefined;
  /** Generic plot data (everything except learning-curve / importance). */
  plotData: PlotResponse | undefined;
  isPlotLoading: boolean;
  isPlotError: boolean;
  /** Learning-curve metric filter state + list from backend. */
  lcMetric: string | null;
  setLcMetric: (m: string | null) => void;
  availableEvalMetrics: string[];
  learningCurve: PlotResponse | undefined;
  isLcError: boolean;
  /** Importance kind state + data. */
  importanceKind: string;
  setImportanceKind: (kind: string) => void;
  importanceKinds: string[] | undefined;
  importance: ImportanceResponse | undefined;
  importancePlot: PlotResponse | undefined;
  isImportancePlotLoading: boolean;
  /**
   * Issue #457 / P-0105: residuals plot kind state + data. ``"all"`` (the
   * default) renders the legacy 3-panel layout; ``scatter`` / ``histogram``
   * / ``qq`` render a single readable panel.
   */
  residualsKind: string;
  setResidualsKind: (kind: string) => void;
  residualsPlot: PlotResponse | undefined;
  isResidualsPlotLoading: boolean;
  isResidualsPlotError: boolean;
  /**
   * PR-B2 / P-0097: top-N projection state for the importance table.
   * `null` means "show all" (no top_n forwarded). The default of 30
   * keeps the wide-DataFrame UX responsive.
   */
  importanceTopN: number | null;
  setImportanceTopN: (n: number | null) => void;
  /** Fold split summary. */
  splitSummary: SplitSummaryRow[] | undefined;
  /** Tuning plot (only populated for tune jobs). */
  tuningPlot: PlotResponse | undefined;
  /** Pivoted metrics for MetricCards / ScoreSection. */
  metrics: Record<string, Record<string, number>> | undefined;
  hasFolds: boolean;
  /** Injects precision_at_k k-value into metric display names. */
  annotateMetric: (name: string) => string;
}

export function useJobResultData({
  job,
  selectedPlot,
}: UseJobResultDataParams): UseJobResultData {
  // --------------------------------------------------------------------
  // Plot availability + generic plot
  // --------------------------------------------------------------------
  const { data: plots } = useQuery({
    queryKey: queryKeys.jobPlots(job.job_id),
    queryFn: () => fetchJobPlots(job.job_id),
  });

  const {
    data: plotData,
    isLoading: isPlotLoading,
    isError: isPlotError,
  } = useQuery({
    queryKey: queryKeys.jobPlot(job.job_id, selectedPlot),
    queryFn: () => fetchJobPlot(job.job_id, selectedPlot),
    enabled:
      !!selectedPlot &&
      selectedPlot !== "learning-curve" &&
      selectedPlot !== "importance" &&
      selectedPlot !== "residuals",
    retry: false,
  });

  // --------------------------------------------------------------------
  // Learning curve — backend is the source of truth for available metrics.
  // (The Jobs page used to parse ``config.model.params.metric``; that
  // shortcut diverged from eval_history reality when LightGBM routed
  // some metrics through feval callables.)
  // --------------------------------------------------------------------
  const [lcMetric, setLcMetric] = useState<string | null>(null);
  // Issue #457 / P-0105: residuals plot kind. Declared up here (rather
  // than in the Residuals section below) so the job-hot-swap reset
  // effect can call ``setResidualsKind`` without a use-before-define.
  const [residualsKind, setResidualsKind] = useState("all");
  const lcInitialized = useRef(false);
  const lcEnabled =
    selectedPlot === "learning-curve" &&
    (plots?.includes("learning-curve") ?? false);

  const { data: lcAvailableMetricsData, isError: isLcMetricsError } = useQuery({
    queryKey: queryKeys.jobLearningCurveMetrics(job.job_id),
    queryFn: () => fetchJobLearningCurveMetrics(job.job_id),
    enabled: lcEnabled,
  });
  const availableEvalMetrics = lcAvailableMetricsData ?? [];

  const { data: learningCurve, isError: isLcPlotError } = useQuery({
    queryKey: queryKeys.jobPlotLearningCurve(job.job_id, lcMetric),
    queryFn: () =>
      fetchJobPlot(job.job_id, "learning-curve", {
        metrics: lcMetric ?? undefined,
      }),
    enabled: lcEnabled,
    retry: false,
  });
  const isLcError = isLcMetricsError || isLcPlotError;

  // When the consumer hot-swaps the job prop, pre-existing lcMetric
  // state must be cleared before the new job's metric list arrives —
  // otherwise the plot query fires with a name that isn't valid for
  // the new job.
  const lastJobIdRef = useRef(job.job_id);
  useEffect(() => {
    if (lastJobIdRef.current !== job.job_id) {
      lastJobIdRef.current = job.job_id;
      setLcMetric(null);
      lcInitialized.current = false;
      // Issue #457: a hot-swapped job starts fresh on the 3-panel view.
      setResidualsKind("all");
    }
  }, [job.job_id]);

  // Drop stale lcMetric when backend no longer lists it.
  useEffect(() => {
    if (!lcAvailableMetricsData) return;
    if (lcMetric !== null && !lcAvailableMetricsData.includes(lcMetric)) {
      setLcMetric(null);
      lcInitialized.current = false;
    }
  }, [lcAvailableMetricsData, lcMetric]);

  // First-run init: default to first metric when multiple exist.
  useEffect(() => {
    if (lcInitialized.current) return;
    if (!lcAvailableMetricsData) return;
    if (lcAvailableMetricsData.length > 1) {
      lcInitialized.current = true;
      setLcMetric(lcAvailableMetricsData[0]);
    } else if (lcAvailableMetricsData.length >= 1) {
      lcInitialized.current = true;
    }
  }, [lcAvailableMetricsData]);

  // --------------------------------------------------------------------
  // Importance
  // --------------------------------------------------------------------
  const importanceEnabled = plots?.includes("importance") ?? false;
  const [importanceKind, setImportanceKind] = useState("split");
  // PR-B2 / P-0097: default to the server-side top-30 projection so the
  // wide-DataFrame importance table stays under the 5MB payload cap and
  // renders in a single frame. Users opt back into the unbounded list
  // via the "Show all" toggle in PlotSection.
  const [importanceTopN, setImportanceTopN] = useState<number | null>(30);

  const { data: importanceKinds } = useQuery({
    queryKey: queryKeys.jobImportanceKinds(job.job_id),
    queryFn: () => fetchJobImportanceKinds(job.job_id),
    enabled: importanceEnabled,
  });

  useEffect(() => {
    if (
      importanceKinds &&
      importanceKinds.length > 0 &&
      !importanceKinds.includes(importanceKind)
    ) {
      setImportanceKind(importanceKinds[0]);
    }
  }, [importanceKinds, importanceKind]);

  const { data: importance } = useQuery({
    queryKey: queryKeys.jobImportance(
      job.job_id,
      importanceKind,
      importanceTopN,
    ),
    queryFn: () =>
      fetchJobImportance(
        job.job_id,
        importanceKind,
        importanceTopN != null ? { topN: importanceTopN } : undefined,
      ),
    enabled: importanceEnabled,
  });

  const { data: importancePlot, isLoading: isImportancePlotLoading } = useQuery(
    {
      queryKey: queryKeys.jobPlotImportance(job.job_id, importanceKind),
      queryFn: () =>
        fetchJobPlot(job.job_id, "importance", { kind: importanceKind }),
      enabled: importanceEnabled,
    },
  );

  // --------------------------------------------------------------------
  // Residuals (Issue #457 / P-0105) — split out of the generic plotData
  // query so the kind selector can refetch per-kind without invalidating
  // the other plots. Default ``"all"`` preserves the legacy 3-panel view.
  // (``residualsKind`` state is declared near the top — see comment there.)
  // --------------------------------------------------------------------
  const residualsEnabled =
    selectedPlot === "residuals" && (plots?.includes("residuals") ?? false);

  const {
    data: residualsPlot,
    isLoading: isResidualsPlotLoading,
    isError: isResidualsPlotError,
  } = useQuery({
    queryKey: queryKeys.jobPlotResiduals(job.job_id, residualsKind),
    queryFn: () =>
      fetchJobPlot(job.job_id, "residuals", { kind: residualsKind }),
    enabled: residualsEnabled,
    retry: false,
  });

  // --------------------------------------------------------------------
  // Split summary + tuning plot
  // --------------------------------------------------------------------
  const { data: splitSummary } = useQuery({
    queryKey: queryKeys.jobSplitSummary(job.job_id),
    queryFn: () => fetchJobSplitSummary(job.job_id),
  });

  const { data: tuningPlot } = useQuery({
    queryKey: queryKeys.jobPlotTuning(job.job_id),
    queryFn: () => fetchJobPlot(job.job_id, "tuning"),
    enabled: job.job_type === "tune",
  });

  // --------------------------------------------------------------------
  // Derived data
  // --------------------------------------------------------------------
  const fitResult = job.fit_result;
  const metrics = fitResult?.metrics
    ? pivotMetrics(fitResult.metrics as Record<string, unknown>)
    : undefined;
  const hasFolds = fitResult != null && fitResult.fold_count > 1;

  const evalConfig = getEvaluationSection(job);
  const annotateMetric = (name: string): string => {
    if (name === "precision_at_k") {
      const entries = Array.isArray(evalConfig.metrics)
        ? (evalConfig.metrics as MetricEntry[])
        : [];
      for (const entry of entries) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          "precision_at_k" in entry
        ) {
          const k = entry.precision_at_k?.k;
          return typeof k === "number" ? `${name}@${k}` : name;
        }
      }
      const k = evalConfig.precision_at_k;
      return typeof k === "number" ? `${name}@${k}` : name;
    }
    return name;
  };

  return {
    plots,
    plotData,
    isPlotLoading,
    isPlotError,
    lcMetric,
    setLcMetric,
    availableEvalMetrics,
    learningCurve,
    isLcError,
    importanceKind,
    setImportanceKind,
    importanceKinds,
    importance,
    importancePlot,
    isImportancePlotLoading,
    residualsKind,
    setResidualsKind,
    residualsPlot,
    isResidualsPlotLoading,
    isResidualsPlotError,
    importanceTopN,
    setImportanceTopN,
    splitSummary,
    tuningPlot,
    metrics,
    hasFolds,
    annotateMetric,
  };
}
