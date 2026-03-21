import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type ComparisonStats,
  fetchInferenceComparison,
  type InferenceRecord,
} from "@/api/inference";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PredictionsTable } from "./PredictionsTable";

interface ResultsPredOnlyProps {
  record: InferenceRecord;
  infNumber: number;
  jobLabel: string;
  history: InferenceRecord[];
}

export function ResultsPredOnly({
  record,
  infNumber,
  jobLabel,
  history,
}: ResultsPredOnlyProps) {
  const [compareInfId, setCompareInfId] = useState("");

  const otherRecords = history.filter((r) => r.inf_id !== record.inf_id);

  const { data: comparison } = useQuery({
    queryKey: ["inf-comparison", record.inf_id, compareInfId, record.job_id],
    queryFn: () =>
      fetchInferenceComparison(record.inf_id, compareInfId, record.job_id),
    enabled: !!compareInfId,
  });

  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold">
          Inf #{infNumber} -- {jobLabel}
        </h2>
        <p className="text-sm text-muted-foreground">
          {record.row_count} rows -- Prediction Only
        </p>
      </div>

      {/* Predictions */}
      <section className="mb-6">
        <h4 className="mb-2 text-sm font-medium">Predictions</h4>
        <PredictionsTable infId={record.inf_id} jobId={record.job_id} />
      </section>

      {/* Comparison */}
      {otherRecords.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-sm font-medium">Comparison</h4>
            <Select value={compareInfId} onValueChange={setCompareInfId}>
              <SelectTrigger className="h-7 w-64 text-xs">
                <SelectValue placeholder="Select past inference" />
              </SelectTrigger>
              <SelectContent>
                {otherRecords.map((r) => {
                  const num = history.length - history.indexOf(r);
                  return (
                    <SelectItem key={r.inf_id} value={r.inf_id}>
                      Inf #{num} -- {r.row_count} rows
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {comparison && (
            <ComparisonTable
              comparison={comparison}
              currentLabel={`Inf #${infNumber}`}
              otherLabel="Compare"
            />
          )}
        </section>
      )}

      {/* Warnings */}
      {record.warnings.length > 0 && (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-medium">Warnings</h4>
          <ul className="list-disc pl-4 text-sm text-orange-600">
            {record.warnings.map((w, i) => (
              <li key={`warn-${i}`}>{w}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ComparisonTable({
  comparison,
  currentLabel,
  otherLabel,
}: {
  comparison: ComparisonStats;
  currentLabel: string;
  otherLabel: string;
}) {
  const statKeys = Object.keys(comparison.current).filter((k) => k !== "count");

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead className="text-center text-xs">{currentLabel}</TableHead>
          <TableHead className="text-center text-xs">{otherLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {statKeys.map((key) => (
          <TableRow key={key}>
            <TableCell className="text-xs font-medium capitalize">
              {formatStatName(key)}
            </TableCell>
            <TableCell className="text-center text-xs">
              {formatNum(comparison.current[key])}
            </TableCell>
            <TableCell className="text-center text-xs">
              {formatNum(comparison.other[key])}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatStatName(key: string): string {
  if (key === "positive_pct") return "Positive %";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatNum(v: unknown): string {
  if (typeof v !== "number") return "--";
  return v.toFixed(4);
}
