import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  fetchInferenceMetrics,
  fetchInferencePlot,
  type InferenceRecord,
} from "@/api/inference";
import { fetchJobPlots } from "@/api/jobs";
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

  const { data: metrics } = useQuery({
    queryKey: ["inf-metrics", record.inf_id, record.job_id],
    queryFn: () => fetchInferenceMetrics(record.inf_id, record.job_id),
  });

  const { data: plots } = useQuery({
    queryKey: ["job-plots", record.job_id],
    queryFn: () => fetchJobPlots(record.job_id),
  });

  const { data: plotData } = useQuery({
    queryKey: ["inf-plot", record.inf_id, record.job_id, selectedPlot],
    queryFn: () =>
      fetchInferencePlot(record.inf_id, record.job_id, selectedPlot),
    enabled: !!selectedPlot,
  });

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
              <SelectTrigger className="h-7 w-48 text-xs">
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

      {/* Accordion sections */}
      <Accordion type="multiple">
        <AccordionItem value="predictions">
          <AccordionTrigger>Predictions</AccordionTrigger>
          <AccordionContent>
            <PredictionsTable infId={record.inf_id} jobId={record.job_id} />
          </AccordionContent>
        </AccordionItem>

        {record.warnings.length > 0 && (
          <AccordionItem value="warnings">
            <AccordionTrigger>Warnings</AccordionTrigger>
            <AccordionContent>
              <ul className="list-disc pl-4 text-sm text-orange-600">
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
