import type { PlotResponse } from "@/api/types";
import { PlotlyChart } from "./PlotlyChart";
import { SegmentGroup } from "./SegmentGroup";

export const PLOT_LABELS: Record<string, string> = {
  "learning-curve": "Learning Curve",
  "oof-distribution": "OOF Dist",
  "roc-curve": "ROC",
  calibration: "Calibration",
  "probability-histogram": "Prob Hist",
  residuals: "Residuals",
  importance: "Importance",
};

interface PlotSectionProps {
  plots: string[];
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  plotData: PlotResponse | undefined;
  learningCurve: PlotResponse | undefined;
  isLoading?: boolean;
  isError?: boolean;
}

export function PlotSection({
  plots,
  selectedPlot,
  onSelectPlot,
  plotData,
  learningCurve,
  isLoading = false,
  isError = false,
}: PlotSectionProps) {
  // Include learning-curve in the button list, exclude tuning
  const availablePlots = plots.filter((p) => p !== "tuning");

  // Resolve which data to display
  const isLearningCurve = selectedPlot === "learning-curve";
  const activePlotData = isLearningCurve ? learningCurve : plotData;
  const chartHeight = isLearningCurve ? 500 : 350;

  if (availablePlots.length === 0) return null;

  return (
    <section className="mb-6 min-w-0">
      <h4 className="mb-2 text-sm font-medium">Plots</h4>
      <div className="mb-3">
        <SegmentGroup
          options={availablePlots}
          value={selectedPlot}
          onChange={onSelectPlot}
          labels={PLOT_LABELS}
        />
      </div>
      {isLoading && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading plot...
        </p>
      )}
      {isError && !isLoading && (
        <p className="py-8 text-center text-sm text-destructive">
          Failed to load plot. This plot may not be available for this model.
        </p>
      )}
      {!isLoading && !isError && activePlotData && (
        <PlotlyChart
          plotlyJson={activePlotData.plotly_json}
          height={chartHeight}
        />
      )}
    </section>
  );
}
