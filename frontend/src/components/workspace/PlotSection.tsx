import type { PlotResponse } from "@/api/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlotlyChart } from "./PlotlyChart";

interface PlotSectionProps {
  plots: string[];
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  plotData: PlotResponse | undefined;
  learningCurve: PlotResponse | undefined;
}

export function PlotSection({
  plots,
  selectedPlot,
  onSelectPlot,
  plotData,
  learningCurve,
}: PlotSectionProps) {
  const filteredPlots = plots.filter(
    (p) => p !== "learning-curve" && p !== "tuning",
  );

  return (
    <>
      {/* Learning Curve */}
      {learningCurve && (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-medium">Learning Curve</h4>
          <PlotlyChart plotlyJson={learningCurve.plotly_json} />
        </section>
      )}

      {/* Plots selector */}
      {filteredPlots.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-sm font-medium">Plots</h4>
            <Select value={selectedPlot} onValueChange={onSelectPlot}>
              <SelectTrigger className="h-7 w-48 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filteredPlots.map((p) => (
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
    </>
  );
}
