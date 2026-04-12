import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TuneRound } from "./types";

export interface RoundHistoryTableProps {
  rounds: TuneRound[];
}

function formatDelta(
  after: number | null,
  before: number | null,
): { text: string; className: string } {
  if (before === null || after === null) {
    return { text: "\u2014", className: "text-muted-foreground" };
  }
  const delta = after - before;
  const sign = delta > 0 ? "+" : "";
  const text = `${sign}${delta.toFixed(4)}`;
  if (delta > 0) {
    return { text, className: "text-emerald-600 dark:text-emerald-400" };
  }
  if (delta < 0) {
    return { text, className: "text-rose-600 dark:text-rose-400" };
  }
  return { text, className: "text-muted-foreground" };
}

function formatExpandedDims(dims: string[]): string {
  if (dims.length === 0) return "\u2014";
  if (dims.length <= 3) return dims.join(", ");
  return `${dims.slice(0, 3).join(", ")} +${dims.length - 3} more`;
}

export function RoundHistoryTable({ rounds }: RoundHistoryTableProps) {
  if (rounds.length === 0) return null;

  return (
    <section className="rounded-md border bg-card p-2">
      <h3 className="text-sm font-medium mb-1 px-1">Round history</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Round</TableHead>
            <TableHead scope="col">Trials</TableHead>
            <TableHead scope="col">Best Score</TableHead>
            <TableHead scope="col">{"Improvement (\u0394)"}</TableHead>
            <TableHead scope="col" className="hidden sm:table-cell">
              Expanded Dims
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rounds.map((round, idx) => {
            const isLast = idx === rounds.length - 1;
            const delta = formatDelta(
              round.best_score_after,
              round.best_score_before,
            );
            return (
              <TableRow
                key={round.round}
                className={
                  isLast
                    ? "bg-accent/60 font-medium dark:bg-accent/40"
                    : "hover:bg-muted/50 even:bg-muted/20"
                }
                aria-current={isLast ? "true" : undefined}
              >
                <TableCell className="text-xs">{round.round}</TableCell>
                <TableCell className="text-xs">{round.n_trials}</TableCell>
                <TableCell className="text-xs tabular-nums">
                  {round.best_score_after !== null
                    ? round.best_score_after.toFixed(4)
                    : "\u2014"}
                </TableCell>
                <TableCell
                  className={`text-xs tabular-nums ${delta.className}`}
                >
                  {delta.text}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-xs">
                  {formatExpandedDims(round.expanded_dims)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
