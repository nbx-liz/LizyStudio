import { Check, Loader2, Minus } from "lucide-react";
import type { FoldResult } from "../../api/types";

interface FoldProgressListProps {
  currentFold: number;
  totalFolds: number;
  foldResults: FoldResult[];
}

/**
 * Pick a metric label + score from a fold-result dict.
 *
 * The backend-emitted shape is ``{ fold: int, <metric>: number, ... }``
 * where each extra key is a metric name (``rmse``, ``r2``, ``auc``,
 * etc.).  Test fixtures sometimes spell it out as ``{fold, metric,
 * score}``; handle both so the UI works regardless of which shape the
 * caller builds.
 */
function firstMetric(result: FoldResult): [string, number] | null {
  const withMetric = result as Partial<{ metric: string; score: number }> &
    Record<string, unknown>;
  if (
    typeof withMetric.metric === "string" &&
    typeof withMetric.score === "number"
  ) {
    return [withMetric.metric, withMetric.score];
  }
  for (const [key, value] of Object.entries(result)) {
    if (key === "fold") continue;
    if (typeof value === "number") return [key, value];
  }
  return null;
}

/** Real-time fold-by-fold score display (H-0047). */
export function FoldProgressList({
  currentFold,
  totalFolds,
  foldResults,
}: FoldProgressListProps) {
  if (totalFolds <= 0) return null;

  return (
    <div className="mt-3 space-y-1">
      {Array.from({ length: totalFolds }, (_, i) => {
        const foldNum = i + 1;
        const result = foldResults.find((r) => r.fold === foldNum);
        const isRunning = foldNum === currentFold + 1 && !result;
        const metric = result ? firstMetric(result) : null;

        return (
          <div
            key={foldNum}
            className="flex items-center gap-2 font-mono text-xs"
          >
            {result ? (
              <Check className="h-3 w-3 text-success-fg" />
            ) : isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin text-info-fg" />
            ) : (
              <Minus className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-muted-foreground">
              Fold {foldNum}/{totalFolds}
            </span>
            {metric && (
              <span className="text-foreground">
                {metric[0]} = {metric[1].toFixed(4)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
