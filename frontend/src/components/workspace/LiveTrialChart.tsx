import { useMemo } from "react";
import type { TrialResult } from "@/api/types";
import { PlotlyChart } from "./PlotlyChart";

export function LiveTrialChart({ trials }: { trials: TrialResult[] }) {
  const plotlyJson = useMemo(() => {
    const valid = trials.filter((t) => t.score != null);
    if (valid.length < 2) return null;
    const x = valid.map((t) => t.number);
    const scores = valid.map((t) => t.score);
    const best = valid.map((t) => t.best_score ?? t.score);
    return JSON.stringify({
      data: [
        {
          x,
          y: scores,
          mode: "markers",
          type: "scatter",
          name: "Score",
          marker: { size: 5, opacity: 0.6 },
        },
        {
          x,
          y: best,
          mode: "lines",
          type: "scatter",
          name: "Best",
          line: { width: 2 },
        },
      ],
      layout: {
        height: 180,
        margin: { t: 10, r: 10, b: 30, l: 50 },
        xaxis: { title: "Trial" },
        yaxis: { title: "Score" },
        showlegend: false,
      },
    });
  }, [trials]);

  if (!plotlyJson) return null;

  return (
    <div className="mt-3 rounded border bg-muted/30 p-1">
      <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">
        Optimization History
      </p>
      <PlotlyChart plotlyJson={plotlyJson} height={180} />
    </div>
  );
}
