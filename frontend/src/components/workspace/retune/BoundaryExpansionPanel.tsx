import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BoundaryDimStatus, BoundaryReport } from "./types";

export interface BoundaryExpansionPanelProps {
  report: BoundaryReport | null | undefined;
}

function formatRange(low: number | null, high: number | null): string {
  if (low === null || high === null) return "\u2014";
  return `${low.toFixed(4)}\u2009\u2014\u2009${high.toFixed(4)}`;
}

function edgeSymbol(dim: BoundaryDimStatus): string {
  if (dim.edge === "upper") return "\u25b2";
  if (dim.edge === "lower") return "\u25bc";
  return "\u2013";
}

export function BoundaryExpansionPanel({
  report,
}: BoundaryExpansionPanelProps) {
  if (report === null || report === undefined) return null;

  if (report.dims.length === 0) {
    return (
      <section className="rounded-md border bg-card p-2">
        <h3 className="text-sm font-medium mb-1 px-1">Boundary report</h3>
        <p className="text-xs text-muted-foreground py-2 px-1">
          No boundary tracking data.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border bg-card p-2">
      <h3 className="text-sm font-medium mb-1 px-1">Boundary report</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Dim</TableHead>
            <TableHead scope="col">Best</TableHead>
            <TableHead scope="col">Range</TableHead>
            <TableHead scope="col">Position</TableHead>
            <TableHead scope="col">Edge</TableHead>
            <TableHead scope="col">Expanded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.dims.map((dim) => (
            <TableRow
              key={dim.name}
              className={
                dim.expanded
                  ? "bg-primary/5 dark:bg-primary/10 border-l-2 border-l-primary"
                  : "hover:bg-muted/50 even:bg-muted/20"
              }
              aria-label={
                dim.expanded ? `${dim.name} \u2014 expanded` : undefined
              }
            >
              <TableCell
                className="font-mono text-xs max-w-[140px] truncate"
                title={dim.name}
              >
                {dim.name}
              </TableCell>
              <TableCell className="text-xs tabular-nums">
                {dim.best_value !== null
                  ? typeof dim.best_value === "number"
                    ? dim.best_value.toFixed(4)
                    : String(dim.best_value)
                  : "\u2014"}
              </TableCell>
              <TableCell className="text-xs tabular-nums">
                {formatRange(dim.low, dim.high)}
              </TableCell>
              <TableCell>
                {dim.position_pct !== null ? (
                  <>
                    <div className="hidden md:flex items-center gap-1.5">
                      <Progress
                        value={dim.position_pct}
                        className="h-1.5 w-12"
                      />
                      <span className="text-xs tabular-nums text-muted-foreground ml-1.5">
                        {dim.position_pct.toFixed(0)}%
                      </span>
                    </div>
                    <span className="md:hidden text-xs tabular-nums text-muted-foreground">
                      {dim.position_pct.toFixed(0)}%
                    </span>
                  </>
                ) : (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {"\u2014"}
                  </span>
                )}
              </TableCell>
              <TableCell
                className={
                  dim.expanded
                    ? "font-bold text-primary text-xs"
                    : "text-muted-foreground text-xs"
                }
              >
                {edgeSymbol(dim)}
              </TableCell>
              <TableCell>
                {dim.expanded ? (
                  <Badge>Yes</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">No</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
