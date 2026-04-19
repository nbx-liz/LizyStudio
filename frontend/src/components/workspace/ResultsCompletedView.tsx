import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  fetchJobImportance,
  fetchJobImportanceKinds,
  fetchJobLearningCurveMetrics,
  fetchJobLineage,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
  type LineageNode,
} from "@/api/jobs";
import type { JobDetail, MetricEntry } from "@/api/types";
import { JobLineageTree } from "@/components/retune/JobLineageTree";
import { RetuneActionButton } from "@/components/retune/RetuneActionButton";
import { MetricCards } from "@/components/shared/MetricCards";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { pivotMetrics } from "@/lib/metrics";
import { ConfigDiffBadge } from "./ConfigDiffBadge";
import { FoldDetailsSection } from "./FoldDetailsSection";
import { PlotSection } from "./PlotSection";
import {
  TrialResultsAccordionItem,
  TuneTrialsSection,
} from "./TuneTrialsSection";

interface ResultsCompletedViewProps {
  job: JobDetail;
  headerLabel: string;
  modelName?: string;
  currentConfig?: Record<string, unknown>;
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  onApplyToFit?: (params: Record<string, unknown>) => void;
  /** Called when a Re-tune child job is successfully started (H-0062). */
  onJobStarted?: (childJobId: string) => void;
}

export function ResultsCompletedView({
  job,
  headerLabel,
  modelName,
  currentConfig,
  selectedPlot,
  onSelectPlot,
  onJobStarted,
  onApplyToFit,
}: ResultsCompletedViewProps) {
  const { data: plots } = useQuery({
    queryKey: ["job-plots", job.job_id],
    queryFn: () => fetchJobPlots(job.job_id),
  });

  const {
    data: plotData,
    isLoading: isPlotLoading,
    isError: isPlotError,
  } = useQuery({
    queryKey: ["job-plot", job.job_id, selectedPlot],
    queryFn: () => fetchJobPlot(job.job_id, selectedPlot),
    enabled:
      !!selectedPlot &&
      selectedPlot !== "learning-curve" &&
      selectedPlot !== "importance",
    retry: false,
  });

  // Learning curve metrics filter (H-0034).
  // The available list comes from the backend — it reflects the actual
  // eval_history keys, not the user-requested metric config, which can
  // diverge when lizyml routes some metrics through feval callables.
  const [lcMetric, setLcMetric] = useState<string | null>(null);
  const lcInitialized = useRef(false);
  const lcEnabled =
    selectedPlot === "learning-curve" &&
    (plots?.includes("learning-curve") ?? false);

  const { data: lcAvailableMetrics, isError: isLcMetricsError } = useQuery({
    queryKey: ["job-learning-curve-metrics", job.job_id],
    queryFn: () => fetchJobLearningCurveMetrics(job.job_id),
    enabled: lcEnabled,
  });

  const { data: learningCurve, isError: isLcPlotError } = useQuery({
    queryKey: ["job-plot", job.job_id, "learning-curve", lcMetric],
    queryFn: () =>
      fetchJobPlot(job.job_id, "learning-curve", {
        metrics: lcMetric ?? undefined,
      }),
    enabled: lcEnabled,
    retry: false,
  });

  const isLcError = isLcMetricsError || isLcPlotError;

  // When the user switches to a different job within the same mounted
  // component instance, any previously selected lcMetric must be
  // cleared before the new job's metrics list arrives — otherwise the
  // plot query fires with a name that isn't valid for the new job.
  const lastJobIdRef = useRef(job.job_id);
  useEffect(() => {
    if (lastJobIdRef.current !== job.job_id) {
      lastJobIdRef.current = job.job_id;
      setLcMetric(null);
      lcInitialized.current = false;
    }
  }, [job.job_id]);

  // If the persisted lcMetric is no longer a valid option (e.g. legacy
  // state from a previous job), drop it so PlotSection falls back to the
  // first available metric. LC fetch errors are left to PlotSection to
  // surface — silently resetting state masked real bugs (H-0061).
  useEffect(() => {
    if (!lcAvailableMetrics) return;
    if (lcMetric !== null && !lcAvailableMetrics.includes(lcMetric)) {
      setLcMetric(null);
      lcInitialized.current = false;
    }
  }, [lcAvailableMetrics, lcMetric]);

  const [importanceKind, setImportanceKind] = useState("split");
  const importanceEnabled = plots?.includes("importance") ?? false;

  const { data: importanceKinds } = useQuery({
    queryKey: ["job-importance-kinds", job.job_id],
    queryFn: () => fetchJobImportanceKinds(job.job_id),
    enabled: importanceEnabled,
  });

  // Sync initial kind with backend response when it differs
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
    queryKey: ["job-importance", job.job_id, importanceKind],
    queryFn: () => fetchJobImportance(job.job_id, importanceKind),
    enabled: importanceEnabled,
  });

  const { data: importancePlot, isLoading: isImportancePlotLoading } = useQuery(
    {
      queryKey: ["job-plot", job.job_id, "importance", importanceKind],
      queryFn: () =>
        fetchJobPlot(job.job_id, "importance", { kind: importanceKind }),
      enabled: importanceEnabled,
    },
  );

  const { data: splitSummary } = useQuery({
    queryKey: ["job-split-summary", job.job_id],
    queryFn: () => fetchJobSplitSummary(job.job_id),
  });

  const { data: tuningPlot } = useQuery({
    queryKey: ["job-plot", job.job_id, "tuning"],
    queryFn: () => fetchJobPlot(job.job_id, "tuning"),
    enabled: job.job_type === "tune",
  });

  // H-0062 acceptance #13: lineage tree wire-in. Only fetch for tune jobs;
  // silently swallow errors because lineage is auxiliary information.
  const { data: lineageData } = useQuery({
    queryKey: ["job-lineage", job.job_id],
    queryFn: () => fetchJobLineage(job.job_id),
    enabled: job.job_type === "tune",
    retry: false,
  });
  const lineageRoot: LineageNode | null = lineageData?.tree ?? null;
  const showLineage =
    lineageRoot != null &&
    (lineageRoot.children.length > 0 || job.parent_job_id != null);

  useEffect(() => {
    if (plots && plots.length > 0 && !selectedPlot) {
      const first = plots.find((p) => p !== "tuning");
      if (first) onSelectPlot(first);
    }
  }, [plots, selectedPlot, onSelectPlot]);

  const fitResult = job.fit_result;
  const tuneResult = job.tune_result;
  const metrics = fitResult?.metrics
    ? pivotMetrics(fitResult.metrics as Record<string, unknown>)
    : undefined;

  // evalConfig is used by annotateMetric() for precision_at_k k-value display.
  const evalConfig = (job.config?.evaluation as Record<string, unknown>) ?? {};

  // Initialize LC filter to first metric (avoid cramped subplots).
  // When only 1 metric exists, lcMetric stays null (no filter needed).
  useEffect(() => {
    if (lcInitialized.current) return;
    if (!lcAvailableMetrics) return;
    if (lcAvailableMetrics.length > 1) {
      lcInitialized.current = true;
      setLcMetric(lcAvailableMetrics[0]);
    } else if (lcAvailableMetrics.length >= 1) {
      lcInitialized.current = true;
    }
  }, [lcAvailableMetrics]);

  const annotateMetric = (name: string): string => {
    if (name === "precision_at_k") {
      // Look for MetricEntry dict form in evaluation.metrics
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
    }
    return name;
  };
  const hasFolds = fitResult != null && fitResult.fold_count > 1;

  const primaryMetric = tuneResult
    ? `${tuneResult.metric_name}: ${Number(tuneResult.best_score ?? 0).toFixed(4)}`
    : metrics
      ? (() => {
          const firstKey = Object.keys(metrics)[0];
          const oos = metrics[firstKey]?.oos;
          return firstKey && oos != null
            ? `${firstKey}: ${Number(oos).toFixed(4)}`
            : null;
        })()
      : null;

  return (
    <div className="h-full min-w-0 overflow-auto p-6">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-lg font-medium">
          {headerLabel} {modelName && `\u2014 ${modelName}`}
        </h3>
        <Badge
          variant="default"
          className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
        >
          Completed
        </Badge>
        {primaryMetric && <Badge variant="secondary">{primaryMetric}</Badge>}
        <ConfigDiffBadge
          jobConfig={(job.config ?? {}) as Record<string, unknown>}
          currentConfig={currentConfig}
        />
        <div className="ml-auto flex gap-2">
          {job.job_type === "tune" && tuneResult && (
            <RetuneActionButton
              jobId={job.job_id}
              defaultNTrials={_defaultRetuneTrials(job)}
              onStarted={onJobStarted}
            />
          )}
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              window.open(`/api/jobs/${job.job_id}/export-code`, "_blank");
            }}
          >
            <Download className="mr-1 h-3 w-3" />
            Export Code
          </Button>
        </div>
      </div>

      {/* H-0062 #13: Job lineage tree (only when relations exist).
          onJobStarted is reused as the node-select handler — the parent
          WorkspacePage treats it as "switch workspace selection to job_id",
          which is exactly the behavior we want when clicking a tree node. */}
      {showLineage && lineageRoot && (
        <div className="mb-3">
          <JobLineageTree root={lineageRoot} onSelect={onJobStarted} />
        </div>
      )}

      {/* Tune results first: Optimization History -> Best Params -> Apply to Fit */}
      {tuneResult && (
        <TuneTrialsSection
          tuneResult={tuneResult}
          tuningPlot={tuningPlot}
          job={job}
          onApplyToFit={onApplyToFit}
        />
      )}

      {/* KPI Summary Cards (IS + OOS + Std) */}
      {metrics && (
        <MetricCards
          metrics={metrics}
          hasFolds={hasFolds}
          annotateMetric={annotateMetric}
        />
      )}

      {/* Learning Curve + Plot selector */}
      {plots && plots.length > 0 && (
        <PlotSection
          plots={plots}
          selectedPlot={selectedPlot}
          onSelectPlot={onSelectPlot}
          plotData={plotData}
          learningCurve={learningCurve}
          isLoading={
            selectedPlot === "importance"
              ? isImportancePlotLoading
              : isPlotLoading
          }
          isError={selectedPlot === "learning-curve" ? isLcError : isPlotError}
          lcMetric={lcMetric}
          onLcMetricChange={setLcMetric}
          availableEvalMetrics={lcAvailableMetrics ?? []}
          importanceKinds={importanceKinds}
          selectedImportanceKind={importanceKind}
          onImportanceKindChange={setImportanceKind}
          importanceData={importance}
          importancePlot={importancePlot}
        />
      )}

      {/* Accordion sections */}
      <Accordion type="multiple">
        {tuneResult && <TrialResultsAccordionItem tuneResult={tuneResult} />}

        {fitResult && (
          <FoldDetailsSection
            fitResult={fitResult}
            hasFolds={hasFolds}
            splitSummary={splitSummary}
          />
        )}
      </Accordion>
    </div>
  );
}

/** H-0062: pick a sensible default n_trials for the Re-tune dialog. */
function _defaultRetuneTrials(job: JobDetail): number {
  const config = job.config as Record<string, unknown> | undefined;
  const tuning = config?.tuning as Record<string, unknown> | undefined;
  const optuna = tuning?.optuna as Record<string, unknown> | undefined;
  const params = optuna?.params as Record<string, unknown> | undefined;
  const raw = params?.n_trials;
  if (typeof raw === "number" && raw > 0) {
    return raw;
  }
  return 50;
}
