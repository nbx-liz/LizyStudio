import { useMemo } from "react";
import Plot from "react-plotly.js";

interface PlotlyChartProps {
  plotlyJson: string;
  className?: string;
}

export function PlotlyChart({ plotlyJson, className }: PlotlyChartProps) {
  const { data, layout } = useMemo(() => {
    try {
      const parsed = JSON.parse(plotlyJson);
      return {
        data: parsed.data ?? [],
        layout: {
          ...(parsed.layout ?? {}),
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
