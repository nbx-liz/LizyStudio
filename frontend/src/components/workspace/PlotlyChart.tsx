import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

const DARK_THEME = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { color: "hsl(210, 40%, 88%)" },
  xaxis: {
    gridcolor: "hsl(217, 33%, 22%)",
    zerolinecolor: "hsl(217, 33%, 25%)",
  },
  yaxis: {
    gridcolor: "hsl(217, 33%, 22%)",
    zerolinecolor: "hsl(217, 33%, 25%)",
  },
} as const;

const LIGHT_THEME = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { color: "hsl(222, 84%, 5%)" },
  xaxis: {
    gridcolor: "hsl(214, 32%, 91%)",
    zerolinecolor: "hsl(214, 32%, 85%)",
  },
  yaxis: {
    gridcolor: "hsl(214, 32%, 91%)",
    zerolinecolor: "hsl(214, 32%, 85%)",
  },
} as const;

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
  const isDark = useIsDark();

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
      // Use backend margin if present, else sensible defaults
      const patched = { ...cleanLayout } as Record<string, unknown>;
      if (!patched.margin) {
        patched.margin = { l: 60, r: 20, t: 40, b: 50 };
      }

      // Add standoff to all yaxis titles to prevent overlap on subplots
      for (const key of Object.keys(patched)) {
        if (key.startsWith("yaxis") && typeof patched[key] === "object") {
          const axis = patched[key] as Record<string, unknown>;
          if (axis.title && typeof axis.title === "object") {
            axis.title = { ...(axis.title as object), standoff: 15 };
          }
        }
      }

      // Apply theme colors to all axes (including subplot axes like xaxis2, yaxis2)
      const theme = isDark ? DARK_THEME : LIGHT_THEME;
      for (const key of Object.keys(patched)) {
        if (
          (key.startsWith("xaxis") || key.startsWith("yaxis")) &&
          typeof patched[key] === "object"
        ) {
          patched[key] = {
            ...(patched[key] as object),
            gridcolor: theme.xaxis.gridcolor,
            zerolinecolor: theme.xaxis.zerolinecolor,
          };
        }
      }

      return {
        data: rawData,
        layout: {
          ...patched,
          autosize: true,
          paper_bgcolor: theme.paper_bgcolor,
          plot_bgcolor: theme.plot_bgcolor,
          font: theme.font,
        },
      };
    } catch {
      return { data: [], layout: { autosize: true } };
    }
  }, [plotlyJson, isDark]);

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
