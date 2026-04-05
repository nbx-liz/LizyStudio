/**
 * Shared KPI metric cards component (H-0050).
 * Displays metric summaries as IS / OOS / Std cards.
 * Used by both ResultsPanel (Workspace) and CompletedContent (Jobs).
 */

interface MetricCardsProps {
  /** Pivoted metrics: { metricName: { is, oos, oos_std } } */
  metrics: Record<string, Record<string, number>>;
  /** Whether to show Std row (typically fold_count > 1). */
  hasFolds: boolean;
  /** Optional annotation function for metric names (e.g. precision_at_k@5). */
  annotateMetric?: (name: string) => string;
}

export function MetricCards({
  metrics,
  hasFolds,
  annotateMetric,
}: MetricCardsProps) {
  const formatLabel = annotateMetric ?? ((name: string) => name);

  return (
    <div className="mb-4 flex flex-wrap gap-2" data-testid="kpi-cards">
      {Object.entries(metrics).map(([name, vals]) => (
        <div
          key={name}
          className="flex flex-col rounded-md border bg-muted/30 px-3 py-1.5 min-w-[100px]"
        >
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide text-center mb-0.5">
            {formatLabel(name)}
          </span>
          <div className="flex justify-between gap-3 text-xs tabular-nums">
            <span className="text-muted-foreground">IS</span>
            <span className="font-medium">
              {vals.is != null ? Number(vals.is).toFixed(4) : "\u2014"}
            </span>
          </div>
          <div className="flex justify-between gap-3 text-xs tabular-nums">
            <span className="text-muted-foreground">OOS</span>
            <span className="font-semibold">
              {vals.oos != null ? Number(vals.oos).toFixed(4) : "\u2014"}
            </span>
          </div>
          {hasFolds && (
            <div className="flex justify-between gap-3 text-xs tabular-nums">
              <span className="text-muted-foreground">Std</span>
              <span>
                {vals.oos_std != null
                  ? Number(vals.oos_std).toFixed(4)
                  : "\u2014"}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
