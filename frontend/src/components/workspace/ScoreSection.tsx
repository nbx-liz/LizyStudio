import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ScoreSectionProps {
  metrics: Record<string, Record<string, number>>;
  hasFolds: boolean;
  annotateMetric: (name: string) => string;
}

export function ScoreSection({
  metrics,
  hasFolds,
  annotateMetric,
}: ScoreSectionProps) {
  return (
    <section className="mb-6">
      <h4 className="mb-2 text-sm font-medium">Score</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead className="text-center">IS</TableHead>
            <TableHead className="text-center">OOS</TableHead>
            {hasFolds && <TableHead className="text-center">OOS Std</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(metrics).map(([name, vals]) => (
            <TableRow key={name} className="hover:bg-muted/50 even:bg-muted/20">
              <TableCell className="font-medium text-xs">
                {annotateMetric(name)}
              </TableCell>
              <TableCell className="text-center text-xs">
                {formatNum(vals.is)}
              </TableCell>
              <TableCell className="text-center text-xs">
                {formatNum(vals.oos)}
              </TableCell>
              {hasFolds && (
                <TableCell className="text-center text-xs">
                  {formatNum(vals.oos_std)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function formatNum(v: unknown): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  return v.toFixed(4);
}
