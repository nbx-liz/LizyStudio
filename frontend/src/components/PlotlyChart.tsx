/**
 * Wrapper that renders a Plotly figure from a JSON string (fig.to_json()).
 */
import { useMemo } from "react";
import { Plot } from "./Plot";

interface PlotlyChartProps {
  json: string;
}

export function PlotlyChart({ json }: PlotlyChartProps) {
  const { data, layout } = useMemo(() => {
    try {
      const parsed = JSON.parse(json);
      return {
        data: parsed.data ?? [],
        layout: { ...parsed.layout, autosize: true },
      };
    } catch {
      return { data: [], layout: {} };
    }
  }, [json]);

  return (
    <Plot
      data={data}
      layout={layout}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
    />
  );
}
