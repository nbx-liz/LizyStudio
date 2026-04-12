import { Button } from "@/components/ui/button";
import type { TuneRound } from "./types";

export interface ConvergenceSignalPanelProps {
  rounds: TuneRound[];
  onApplyToFit?: () => void;
}

export function ConvergenceSignalPanel({
  rounds,
  onApplyToFit,
}: ConvergenceSignalPanelProps) {
  const lastRound = rounds[rounds.length - 1];

  const improvement =
    lastRound.best_score_after !== null && lastRound.best_score_before !== null
      ? Math.abs(lastRound.best_score_after - lastRound.best_score_before)
      : null;

  const converged =
    lastRound.expanded_dims.length === 0 &&
    (improvement === null || improvement < 0.001);

  if (converged) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40"
      >
        <span
          className="mt-0.5 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        >
          ✓
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            Search space converged
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Round {lastRound.round} finished without boundary expansion. No
            further tuning needed.
          </p>
        </div>
        <Button size="sm" onClick={onApplyToFit} disabled={!onApplyToFit}>
          Apply Best Params to Fit
        </Button>
      </div>
    );
  }

  if (lastRound.expanded_dims.length > 0) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-md border border-primary/30 bg-accent p-3 dark:border-primary/20"
      >
        <span className="mt-0.5 text-primary" aria-hidden="true">
          ↻
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Active exploration
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Boundary expanding — consider another round for deeper search.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
