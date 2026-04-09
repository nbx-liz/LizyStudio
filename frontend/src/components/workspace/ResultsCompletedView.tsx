import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchJobImportance,
  fetchJobImportanceKinds,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
} from "@/api/jobs";
import type { JobDetail, MetricEntry } from "@/api/types";
import { MetricCards } from "@/components/shared/MetricCards";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { pivotMetrics } from "@/lib/metrics";
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
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  onApplyToFit?: (params: Record<string, unknown>) => void;
}

export function ResultsCompletedView({
  job,
  headerLabel,
  modelName,
  selectedPlot,
  onSelectPlot,
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

  // Learning curve metrics filter (H-0034)
  // Default to first metric only to avoid cramped subplots when multiple exist
  const [lcMetric, setLcMetric] = useState<string | null>(null);
  const lcInitialized = useRef(false);

  const { data: learningCurve, isError: isLcError } = useQuery({
    queryKey: ["job-plot", job.job_id, "learning-curve", lcMetric],
    queryFn: () =>
      fetchJobPlot(job.job_id, "learning-curve", {
        metrics: lcMetric ?? undefined,
      }),
    enabled:
      selectedPlot === "learning-curve" &&
      (plots?.includes("learning-curve") ?? false),
    retry: false,
  });

  // If LC filter fails (e.g. feval-only metric), fall back to unfiltered view
  useEffect(() => {
    if (isLcError && lcMetric !== null) {
      setLcMetric(null);
    }
  }, [isLcError, lcMetric]);

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

  // LC filter uses model.params.metric (LightGBM internal metric names)
  // which match the subplot titles in the learning curve plot.
  // If metric is unset in job config (e.g. legacy jobs), lcAvailableMetrics
  // is empty and the filter is hidden — all subplots are shown unfiltered.
  const modelConfig = (job.config?.model as Record<string, unknown>) ?? {};
  const lcAvailableMetrics = useMemo(() => {
    const m = (modelConfig.params as Record<string, unknown>)?.metric;
    if (Array.isArray(m)) return m as string[];
    if (typeof m === "string") return [m];
    return [];
  }, [modelConfig.params]);

  // Initialize LC filter to first metric (avoid cramped subplots).
  // When only 1 metric exists, lcMetric stays null (no filter needed).
  useEffect(() => {
    if (lcInitialized.current) return;
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
        <div className="ml-auto">
          <Button
            variant="outline"
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
          isError={isPlotError}
          lcMetric={lcMetric}
          onLcMetricChange={setLcMetric}
          availableEvalMetrics={lcAvailableMetrics}
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
