import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNum } from "@/lib/utils";

interface ScoreTableProps {
  metrics: {
    inf: Record<string, number>;
    is: Record<string, number>;
    oos: Record<string, number>;
  };
}

export function ScoreTable({ metrics }: ScoreTableProps) {
  const metricNames = Object.keys(metrics.inf);
  if (metricNames.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead className="text-center text-xs">IS</TableHead>
          <TableHead className="text-center text-xs">OOS</TableHead>
          <TableHead className="text-center text-xs">Inf</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {metricNames.map((name) => {
          const infVal = metrics.inf[name];
          const oosVal = metrics.oos[name];
          const isDegraded = isDegradedScore(name, infVal, oosVal);
          return (
            <TableRow key={name}>
              <TableCell className="text-xs font-medium">{name}</TableCell>
              <TableCell className="text-center text-xs">
                {formatNum(metrics.is[name])}
              </TableCell>
              <TableCell className="text-center text-xs">
                {formatNum(oosVal)}
              </TableCell>
              <TableCell
                className={`text-center text-xs ${isDegraded ? "text-degraded-fg font-medium" : ""}`}
              >
                {formatNum(infVal)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Detect if inference score is significantly worse than OOS. */
function isDegradedScore(
  name: string,
  infVal: number | undefined,
  oosVal: number | undefined,
): boolean {
  if (infVal == null || oosVal == null) return false;
  // For error metrics (lower is better): mse, rmse, mae, logloss
  const lowerBetter = ["mse", "rmse", "mae", "logloss"];
  if (lowerBetter.includes(name.toLowerCase())) {
    return infVal > oosVal * 1.1;
  }
  // For score metrics (higher is better): auc, r2, accuracy
  return infVal < oosVal * 0.9;
}
