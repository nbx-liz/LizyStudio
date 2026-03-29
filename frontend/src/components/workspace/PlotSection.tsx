import { Maximize2 } from "lucide-react";
import { useState } from "react";
import type { PlotResponse } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChipGroup } from "./ChipGroup";
import { PlotlyChart } from "./PlotlyChart";
import { SegmentGroup } from "./SegmentGroup";

const PLOT_LABELS: Record<string, string> = {
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
  /** Selected metrics for learning curve filter (null = show all). */
  lcMetrics?: string[] | null;
  onLcMetricsChange?: (metrics: string[] | null) => void;
  /** Available evaluation metrics (for the filter chip list). */
  availableEvalMetrics?: string[];
}

export function PlotSection({
  plots,
  selectedPlot,
  onSelectPlot,
  plotData,
  learningCurve,
  isLoading = false,
  isError = false,
  lcMetrics,
  onLcMetricsChange,
  availableEvalMetrics,
}: PlotSectionProps) {
  // Include learning-curve in the button list, exclude tuning
  const availablePlots = plots.filter((p) => p !== "tuning");

  // Resolve which data to display
  const isLearningCurve = selectedPlot === "learning-curve";
  const activePlotData = isLearningCurve ? learningCurve : plotData;
  const chartHeight = isLearningCurve ? 500 : 350;

  // Show LC filter when: on learning curve tab + more than 1 metric available
  const showLcFilter =
    isLearningCurve &&
    availableEvalMetrics != null &&
    availableEvalMetrics.length > 1 &&
    onLcMetricsChange != null;

  const [fullscreen, setFullscreen] = useState(false);

  if (availablePlots.length === 0) return null;

  return (
    <section className="mb-6 min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium">Plots</h4>
        {activePlotData && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => setFullscreen(true)}
            aria-label="Fullscreen plot"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="mb-3">
        <SegmentGroup
          options={availablePlots}
          value={selectedPlot}
          onChange={onSelectPlot}
          labels={PLOT_LABELS}
        />
      </div>

      {showLcFilter && (
        <div className="mb-3">
          <p className="mb-1 text-xs text-muted-foreground">Filter metrics</p>
          <ChipGroup
            options={availableEvalMetrics}
            selected={lcMetrics ?? availableEvalMetrics}
            onChange={(selected) => {
              // If all selected → null (show all, no filter)
              if (selected.length === availableEvalMetrics.length) {
                onLcMetricsChange(null);
              } else if (selected.length === 0) {
                // Prevent empty — reset to all
                onLcMetricsChange(null);
              } else {
                onLcMetricsChange(selected);
              }
            }}
            minSelected={1}
          />
        </div>
      )}

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

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-h-[90vh] max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>
              {PLOT_LABELS[selectedPlot] ?? selectedPlot}
            </DialogTitle>
          </DialogHeader>
          {activePlotData && (
            <PlotlyChart plotlyJson={activePlotData.plotly_json} height={600} />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
