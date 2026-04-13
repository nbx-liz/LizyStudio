import { BoundaryExpansionPanel } from "./BoundaryExpansionPanel";
import { ConvergenceSignalPanel } from "./ConvergenceSignalPanel";
import { RoundHistoryTable } from "./RoundHistoryTable";
import type { BoundaryReport, TuneRound } from "./types";

export interface RetuneDashboardProps {
  rounds: TuneRound[] | null | undefined;
  boundaryReport: BoundaryReport | null | undefined;
  onApplyToFit?: () => void;
}

export function RetuneDashboard({
  rounds,
  boundaryReport,
  onApplyToFit,
}: RetuneDashboardProps) {
  const showConvergence = rounds != null && rounds.length >= 2;
  const showHistory = rounds != null && rounds.length > 0;
  const showBoundary = boundaryReport != null;

  if (!showConvergence && !showHistory && !showBoundary) {
    return null;
  }

  return (
    <div className="space-y-3">
      {showConvergence && (
        <ConvergenceSignalPanel rounds={rounds} onApplyToFit={onApplyToFit} />
      )}
      {showHistory && <RoundHistoryTable rounds={rounds} />}
      {showBoundary && <BoundaryExpansionPanel report={boundaryReport} />}
    </div>
  );
}
