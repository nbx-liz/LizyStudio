/**
 * Shared "completed job" results renderer used by both the Workspace
 * ResultsCompletedView and the Jobs page CompletedContent. Renders tune
 * results, KPI cards, plots, and the accordion. Consumers supply their
 * own header/footer chrome and can opt in to a detailed score accordion
 * item that is only shown on the Jobs page today.
 *
 * Depends on useJobResultData for the actual data — this component is
 * pure presentation.
 */

import type { JobDetail } from "@/api/types";
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
import type { UseJobResultData } from "@/hooks/useJobResultData";

export interface JobResultsBodyProps {
  job: JobDetail;
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  data: UseJobResultData;
  /** When true, inserts a "View Details" accordion item with the detailed
   * score breakdown — used by the Jobs page only. */
  showScoreAccordion?: boolean;
  /** Optional Apply-to-Fit hook for TuneTrialsSection (Workspace only). */
  onApplyToFit?: (params: Record<string, unknown>) => void;
}

export function JobResultsBody({
  job,
  selectedPlot,
  onSelectPlot,
  data,
  showScoreAccordion = false,
  onApplyToFit,
}: JobResultsBodyProps) {
  const {
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
  } = data;

  const tuneResult = job.tune_result;
  const fitResult = job.fit_result;

  return (
    <>
      {tuneResult && (
        <TuneTrialsSection
          tuneResult={tuneResult}
          tuningPlot={tuningPlot}
          job={job}
          onApplyToFit={onApplyToFit}
        />
      )}

      {metrics && (
        <MetricCards
          metrics={metrics}
          hasFolds={hasFolds}
          annotateMetric={annotateMetric}
        />
      )}

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
              : selectedPlot === "residuals"
                ? isResidualsPlotLoading
                : isPlotLoading
          }
          isError={
            selectedPlot === "learning-curve"
              ? isLcError
              : selectedPlot === "residuals"
                ? isResidualsPlotError
                : isPlotError
          }
          lcMetric={lcMetric}
          onLcMetricChange={setLcMetric}
          availableEvalMetrics={availableEvalMetrics}
          importanceKinds={importanceKinds}
          selectedImportanceKind={importanceKind}
          onImportanceKindChange={setImportanceKind}
          importanceData={importance}
          importancePlot={importancePlot}
          residualsPlot={residualsPlot}
          selectedResidualsKind={residualsKind}
          onResidualsKindChange={setResidualsKind}
          importanceTopN={importanceTopN}
          onImportanceTopNChange={setImportanceTopN}
        />
      )}

      <Accordion type="multiple">
        {tuneResult && <TrialResultsAccordionItem tuneResult={tuneResult} />}

        {showScoreAccordion && metrics && (
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
