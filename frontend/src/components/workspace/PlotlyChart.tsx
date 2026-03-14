import { useMemo } from "react";
import Plot from "react-plotly.js";

interface PlotlyChartProps {
  plotlyJson: string;
  className?: string;
}

export function PlotlyChart({ plotlyJson, className }: PlotlyChartProps) {
  const { data, layout } = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(plotlyJson);
      if (typeof parsed !== "object" || parsed === null) {
        return { data: [], layout: { autosize: true } };
      }
      const obj = parsed as Record<string, unknown>;
      const rawData = Array.isArray(obj.data) ? obj.data : [];
      const rawLayout =
        typeof obj.layout === "object" && obj.layout !== null ? obj.layout : {};
      return {
        data: rawData,
        layout: {
          ...(rawLayout as object),
          autosize: true,
          margin: { l: 50, r: 20, t: 30, b: 50 },
        },
      };
    } catch {
      return { data: [], layout: { autosize: true } };
    }
  }, [plotlyJson]);

  return (
    <div className={className}>
      <Plot
        data={data}
        layout={layout}
        config={{ responsive: true, displayModeBar: false }}
        useResizeHandler
        style={{ width: "100%", height: "300px" }}
      />
    </div>
  );
}
