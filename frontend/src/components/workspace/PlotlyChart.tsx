import { useMemo } from "react";
import Plot from "react-plotly.js";

interface PlotlyChartProps {
  plotlyJson: string;
  className?: string;
  /** Chart height in pixels. Defaults to 350. */
  height?: number;
}

export function PlotlyChart({
  plotlyJson,
  className,
  height = 350,
}: PlotlyChartProps) {
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
      // Remove fixed width/height from backend layout to enable responsive sizing
      const {
        width: _w,
        height: _h,
        ...cleanLayout
      } = rawLayout as Record<string, unknown>;
      // Preserve backend margin if present, else use sensible defaults
      const defaultMargin = { l: 60, r: 20, t: 40, b: 50 };
      const backendMargin = cleanLayout.margin as
        | Record<string, number>
        | undefined;

      // Add standoff to all yaxis titles to prevent overlap on subplots
      const patched = { ...cleanLayout } as Record<string, unknown>;
      for (const key of Object.keys(patched)) {
        if (key.startsWith("yaxis") && typeof patched[key] === "object") {
          const axis = patched[key] as Record<string, unknown>;
          if (axis.title && typeof axis.title === "object") {
            axis.title = { ...(axis.title as object), standoff: 15 };
          }
        }
      }

      return {
        data: rawData,
        layout: {
          ...patched,
          autosize: true,
          margin: backendMargin ?? defaultMargin,
        },
      };
    } catch {
      return { data: [], layout: { autosize: true } };
    }
  }, [plotlyJson]);

  return (
    <div className={`overflow-hidden min-w-0 ${className ?? ""}`}>
      <Plot
        data={data}
        layout={layout}
        config={{ responsive: true, displayModeBar: false }}
        useResizeHandler
        style={{ width: "100%", height: `${height}px` }}
      />
    </div>
  );
}
