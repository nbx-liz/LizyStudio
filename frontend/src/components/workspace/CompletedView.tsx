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
import { metricEntryName } from "@/api/types";
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

interface CompletedViewProps {
  job: JobDetail;
  headerLabel: string;
  modelName?: string;
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  onApplyToFit?: (params: Record<string, unknown>) => void;
}

export function CompletedView({
  job,
  headerLabel,
  modelName,
  selectedPlot,
  onSelectPlot,
  onApplyToFit,
}: CompletedViewProps) {
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
  const [lcMetrics, setLcMetrics] = useState<string[] | null>(null);
  const lcInitialized = useRef(false);

  const { data: learningCurve, isError: isLcError } = useQuery({
    queryKey: ["job-plot", job.job_id, "learning-curve", lcMetrics],
    queryFn: () =>
      fetchJobPlot(job.job_id, "learning-curve", {
        metrics: lcMetrics ?? undefined,
      }),
    enabled:
      selectedPlot === "learning-curve" &&
      (plots?.includes("learning-curve") ?? false),
    retry: false,
  });

  // If LC filter fails (e.g. feval-only metric), fall back to unfiltered view
  useEffect(() => {
    if (isLcError && lcMetrics !== null) {
      setLcMetrics(null);
    }
  }, [isLcError, lcMetrics]);

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

  // Importance plot is kind-independent (shows default split importance).
  // The backend plot API does not accept a kind parameter; the plot is
  // generated once using the default kind by LizyML's importance_plot().
  const { data: importancePlot, isLoading: isImportancePlotLoading } = useQuery(
    {
      queryKey: ["job-plot", job.job_id, "importance"],
      queryFn: () => fetchJobPlot(job.job_id, "importance"),
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

  const evalConfig = (job.config?.evaluation as Record<string, unknown>) ?? {};

  // Extract metric names for LC filter chips.
  // Primary: from job config evaluation.metrics
  // Fallback: from fit_result metrics (covers cases where evaluation.metrics
  // is empty/unset — e.g. default config without explicit metric selection,
  // or feval-only metrics added by LizyML internally).
  const evalMetricNames = useMemo(() => {
    const entries = Array.isArray(evalConfig.metrics)
      ? (evalConfig.metrics as MetricEntry[])
      : [];
    const names = entries.map(metricEntryName);
    if (names.length > 0) return names;
    return metrics ? Object.keys(metrics) : [];
  }, [evalConfig.metrics, metrics]);

  // Initialize LC filter to first metric only (avoid cramped subplot layout)
  // When only 1 metric exists, lcMetrics stays null (no filter needed)
  useEffect(() => {
    if (lcInitialized.current) return;
    if (evalMetricNames.length > 1) {
      lcInitialized.current = true;
      setLcMetrics([evalMetricNames[0]]);
    } else if (evalMetricNames.length === 1) {
      lcInitialized.current = true;
    }
  }, [evalMetricNames]);

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

      {/* KPI Summary Cards (IS + OOS + Std) */}
      {metrics && (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="kpi-cards">
          {Object.entries(metrics).map(([name, vals]) => (
            <div
              key={name}
              className="flex flex-col rounded-md border bg-muted/30 px-3 py-1.5 min-w-[100px]"
            >
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide text-center mb-0.5">
                {annotateMetric(name)}
              </span>
              <div className="flex justify-between gap-3 text-xs tabular-nums">
                <span className="text-muted-foreground">IS</span>
                <span className="font-medium">
                  {vals.is != null ? Number(vals.is).toFixed(4) : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-3 text-xs tabular-nums">
                <span className="text-muted-foreground">OOS</span>
                <span className="font-semibold">
                  {vals.oos != null ? Number(vals.oos).toFixed(4) : "—"}
                </span>
              </div>
              {hasFolds && (
                <div className="flex justify-between gap-3 text-xs tabular-nums">
                  <span className="text-muted-foreground">Std</span>
                  <span>
                    {vals.oos_std != null
                      ? Number(vals.oos_std).toFixed(4)
                      : "—"}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tuneResult && (
        <TuneTrialsSection
          tuneResult={tuneResult}
          tuningPlot={tuningPlot}
          job={job}
          onApplyToFit={onApplyToFit}
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
          lcMetrics={lcMetrics}
          onLcMetricsChange={setLcMetrics}
          availableEvalMetrics={evalMetricNames}
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
