import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchJobImportance,
  fetchJobImportanceKinds,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
} from "@/api/jobs";
import { queryKeys } from "@/api/queryKeys";
import type { JobDetail, MetricEntry } from "@/api/types";
import { MetricCards } from "@/components/shared/MetricCards";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FoldDetailsSection } from "@/components/workspace/FoldDetailsSection";
import { PlotSection } from "@/components/workspace/PlotSection";
import { ScoreSection } from "@/components/workspace/ScoreSection";
import {
  TrialResultsAccordionItem,
  TuneTrialsSection,
} from "@/components/workspace/TuneTrialsSection";
import { pivotMetrics } from "@/lib/metrics";

interface CompletedContentProps {
  job: JobDetail;
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
}

export function CompletedContent({
  job,
  selectedPlot,
  onSelectPlot,
}: CompletedContentProps) {
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
      selectedPlot !== "importance",
    retry: false,
  });

  // Learning curve metric filter (H-0051) — single-select
  const [lcMetric, setLcMetric] = useState<string | null>(null);
  const lcInitialized = useRef(false);

  const { data: learningCurve, isError: isLcError } = useQuery({
    queryKey: queryKeys.jobPlotLearningCurve(job.job_id, lcMetric),
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

  // Importance kind selector (H-0052)
  const importanceEnabled = plots?.includes("importance") ?? false;
  const [importanceKind, setImportanceKind] = useState("split");

  const { data: importanceKinds } = useQuery({
    queryKey: queryKeys.jobImportanceKinds(job.job_id),
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
    queryKey: queryKeys.jobImportance(job.job_id, importanceKind),
    queryFn: () => fetchJobImportance(job.job_id, importanceKind),
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

  const { data: splitSummary } = useQuery({
    queryKey: queryKeys.jobSplitSummary(job.job_id),
    queryFn: () => fetchJobSplitSummary(job.job_id),
  });

  const { data: tuningPlot } = useQuery({
    queryKey: queryKeys.jobPlotTuning(job.job_id),
    queryFn: () => fetchJobPlot(job.job_id, "tuning"),
    enabled: job.job_type === "tune",
  });

  // Auto-select first plot (learning-curve first)
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
  const hasFolds = fitResult != null && fitResult.fold_count > 1;

  const evalConfig = (job.config?.evaluation as Record<string, unknown>) ?? {};

  // LC filter uses model.params.metric (LightGBM internal metric names)
  // which match the subplot titles in the learning curve plot.
  const modelConfig = (job.config?.model as Record<string, unknown>) ?? {};
  const lcAvailableMetrics = useMemo(() => {
    const m = (modelConfig.params as Record<string, unknown>)?.metric;
    if (Array.isArray(m)) return m as string[];
    if (typeof m === "string") return [m];
    return [];
  }, [modelConfig.params]);

  // Initialize LC filter to first metric (single-select).
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
      // Fallback: check evaluation config directly
      const k = evalConfig.precision_at_k;
      return typeof k === "number" ? `${name}@${k}` : name;
    }
    return name;
  };

  return (
    <>
      {/* Tune: Optimization History + Best Params */}
      {tuneResult && (
        <TuneTrialsSection
          tuneResult={tuneResult}
          tuningPlot={tuningPlot}
          job={job}
        />
      )}

      {/* KPI Summary Cards (H-0050) */}
      {metrics && (
        <MetricCards
          metrics={metrics}
          hasFolds={hasFolds}
          annotateMetric={annotateMetric}
        />
      )}

      {/* Plots (including Learning Curve with filter H-0051, Importance with kind selector H-0052) */}
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

        {/* Score table (detailed fold view) inside accordion (H-0050) */}
        {metrics && (
          <AccordionItem value="score-details">
            <AccordionTrigger className="text-sm">
              View Details
            </AccordionTrigger>
            <AccordionContent>
              <ScoreSection
                metrics={metrics}
                hasFolds={hasFolds}
                annotateMetric={annotateMetric}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {fitResult && (
          <FoldDetailsSection
            fitResult={fitResult}
            hasFolds={hasFolds}
            splitSummary={splitSummary}
          />
        )}
      </Accordion>
    </>
  );
}
