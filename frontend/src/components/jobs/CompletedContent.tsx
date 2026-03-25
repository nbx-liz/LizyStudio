import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  fetchJobImportance,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
} from "@/api/jobs";
import type { JobDetail } from "@/api/types";
import { Accordion } from "@/components/ui/accordion";
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
    enabled: !!selectedPlot && selectedPlot !== "learning-curve",
    retry: false,
  });

  const { data: learningCurve } = useQuery({
    queryKey: ["job-plot", job.job_id, "learning-curve"],
    queryFn: () => fetchJobPlot(job.job_id, "learning-curve"),
    enabled:
      selectedPlot === "learning-curve" &&
      (plots?.includes("learning-curve") ?? false),
  });

  const { data: importance } = useQuery({
    queryKey: ["job-importance", job.job_id],
    queryFn: () => fetchJobImportance(job.job_id),
  });

  const { data: importancePlot } = useQuery({
    queryKey: ["job-plot", job.job_id, "importance"],
    queryFn: () => fetchJobPlot(job.job_id, "importance"),
    enabled: plots?.includes("importance") ?? false,
  });

  const { data: splitSummary } = useQuery({
    queryKey: ["job-split-summary", job.job_id],
    queryFn: () => fetchJobSplitSummary(job.job_id),
  });

  const { data: tuningPlot } = useQuery({
    queryKey: ["job-plot", job.job_id, "tuning"],
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

  const annotateMetric = (name: string): string => {
    const evalConfig =
      (job.config?.evaluation as Record<string, unknown>) ?? {};
    if (name === "precision_at_k") {
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

      {/* Score */}
      {metrics && (
        <ScoreSection
          metrics={metrics}
          hasFolds={hasFolds}
          annotateMetric={annotateMetric}
        />
      )}

      {/* Plots (including Learning Curve) */}
      {plots && plots.length > 0 && (
        <PlotSection
          plots={plots}
          selectedPlot={selectedPlot}
          onSelectPlot={onSelectPlot}
          plotData={plotData}
          learningCurve={learningCurve}
          isLoading={isPlotLoading}
          isError={isPlotError}
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
            importance={importance}
            importancePlot={importancePlot}
          />
        )}
      </Accordion>
    </>
  );
}
