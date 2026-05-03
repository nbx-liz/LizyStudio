import { useEffect, useState } from "react";
import type { InferenceRecord } from "@/api/inference";
import {
  useInferenceMetrics,
  useInferencePlot,
  useInferenceShap,
  useJobPlots,
} from "@/api/queries";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlotlyChart } from "@/components/workspace/PlotlyChart";
import { PredictionsTable } from "./PredictionsTable";
import { ScoreTable } from "./ScoreTable";

interface ResultsWithGTProps {
  record: InferenceRecord;
  infNumber: number;
  jobLabel: string;
  targetCol: string;
}

export function ResultsWithGT({
  record,
  infNumber,
  jobLabel,
  targetCol,
}: ResultsWithGTProps) {
  const [selectedPlot, setSelectedPlot] = useState("");

  const { data: metrics } = useInferenceMetrics(record.inf_id, record.job_id);
  const { data: plots } = useJobPlots(record.job_id);
  const { data: plotData } = useInferencePlot(
    record.inf_id,
    record.job_id,
    selectedPlot,
    { enabled: !!selectedPlot },
  );

  // Auto-select first plot
  useEffect(() => {
    if (plots && plots.length > 0 && !selectedPlot) {
      const first = plots.find(
        (p) => p !== "learning-curve" && p !== "tuning" && p !== "importance",
      );
      if (first) setSelectedPlot(first);
    }
  }, [plots, selectedPlot]);

  const hasThreeColumn =
    metrics != null &&
    typeof metrics === "object" &&
    "inf" in metrics &&
    "is" in metrics &&
    "oos" in metrics;

  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold">
          Inf #{infNumber} -- {jobLabel}
        </h2>
        <p className="text-sm text-muted-foreground">
          {record.row_count} rows -- Ground Truth: &apos;{targetCol}&apos;
        </p>
      </div>

      {/* Score */}
      {hasThreeColumn && (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-medium">Score</h4>
          <ScoreTable
            metrics={
              metrics as {
                inf: Record<string, number>;
                is: Record<string, number>;
                oos: Record<string, number>;
              }
            }
          />
        </section>
      )}

      {/* Plots */}
      {plots && plots.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-sm font-medium">Plots</h4>
            <Select value={selectedPlot} onValueChange={setSelectedPlot}>
              <SelectTrigger
                aria-label="Select plot"
                className="h-7 w-48 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {plots
                  .filter(
                    (p) =>
                      p !== "learning-curve" &&
                      p !== "tuning" &&
                      p !== "importance",
                  )
                  .map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.replace(/-/g, " ")}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {plotData && <PlotlyChart plotlyJson={plotData.plotly_json} />}
        </section>
      )}

      {/* Accordion sections.
          Issue #370: ``PredDistributionAccordion`` reads the
          backend's available-plots list and only renders the section
          when the matching plot type exists, so a regression fit (or
          any task without ``probability-histogram``) no longer shows
          an empty accordion or fires a 404. */}
      <Accordion type="multiple">
        <PredDistributionAccordion
          infId={record.inf_id}
          jobId={record.job_id}
        />

        <AccordionItem value="predictions">
          <AccordionTrigger>Predictions</AccordionTrigger>
          <AccordionContent>
            <PredictionsTable infId={record.inf_id} jobId={record.job_id} />
          </AccordionContent>
        </AccordionItem>

        <ShapAccordionItem infId={record.inf_id} jobId={record.job_id} />

        {record.warnings.length > 0 && (
          <AccordionItem value="warnings">
            <AccordionTrigger>Warnings</AccordionTrigger>
            <AccordionContent>
              <ul className="list-disc pl-4 text-sm text-degraded-fg">
                {record.warnings.map((w, i) => (
                  <li key={`warn-${i}`}>{w}</li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}

/**
 * Prediction distribution accordion section. Issue #370.
 *
 * Gates on the backend's available-plots list — same pattern as
 * the SHAP gate from Issue #355. Binary classification exposes
 * ``probability-histogram``; regression has no equivalent today,
 * so the entire accordion item is omitted instead of rendering an
 * empty body and a 404 in DevTools.
 */
function PredDistributionAccordion({
  infId,
  jobId,
}: {
  infId: string;
  jobId: string;
}) {
  const { data: availablePlots } = useJobPlots(jobId);
  const distributionPlotType = availablePlots?.includes("probability-histogram")
    ? "probability-histogram"
    : null;
  const { data, isLoading } = useInferencePlot(
    infId,
    jobId,
    distributionPlotType ?? "",
    { retry: false, enabled: distributionPlotType != null },
  );
  if (distributionPlotType == null) return null;
  return (
    <AccordionItem value="pred-distribution">
      <AccordionTrigger>Prediction Distribution</AccordionTrigger>
      <AccordionContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">
            Loading distribution...
          </p>
        ) : data ? (
          <PlotlyChart plotlyJson={data.plotly_json} />
        ) : null}
      </AccordionContent>
    </AccordionItem>
  );
}

/** SHAP summary accordion item — renders only when SHAP data is available.
 *
 * Issue #355: gate the SHAP fetch on the backend's ``available_plots``
 * so we never request ``shap-summary`` from a backend that does not
 * advertise it. Without this gate the lizyml backend returns 404 on
 * every Inference run, polluting the browser console.
 */
function ShapAccordionItem({ infId, jobId }: { infId: string; jobId: string }) {
  const { data: availablePlots } = useJobPlots(jobId);
  const shapAvailable = availablePlots?.includes("shap-summary") ?? false;
  const { data, isLoading } = useInferenceShap(infId, jobId, {
    retry: false,
    enabled: shapAvailable,
  });

  if (!data && !isLoading) return null;

  return (
    <AccordionItem value="shap-summary">
      <AccordionTrigger>SHAP Summary</AccordionTrigger>
      <AccordionContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">
            Loading SHAP summary...
          </p>
        ) : data ? (
          <PlotlyChart plotlyJson={data.plotly_json} />
        ) : null}
      </AccordionContent>
    </AccordionItem>
  );
}
