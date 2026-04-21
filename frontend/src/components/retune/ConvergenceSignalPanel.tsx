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
        className="flex items-start gap-3 rounded-md border border-success-border bg-success p-3"
      >
        <span className="mt-0.5 text-success-fg" aria-hidden="true">
          ✓
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-success-fg">
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

  // Search space is stable (no expansion) but the score is still moving —
  // treat as a soft "stabilising" signal rather than leaving the slot blank.
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border bg-card p-3"
    >
      <span className="mt-0.5 text-muted-foreground" aria-hidden="true">
        ·
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Stabilising</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Search space is stable but the best score is still improving. Another
          round may still pay off.
        </p>
      </div>
    </div>
  );
}
