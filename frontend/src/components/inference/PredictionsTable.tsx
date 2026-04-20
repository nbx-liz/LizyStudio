import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import {
  fetchInferencePredictions,
  getInferenceDownloadUrl,
} from "@/api/inference";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

interface PredictionsTableProps {
  infId: string;
  jobId: string;
}

export function PredictionsTable({ infId, jobId }: PredictionsTableProps) {
  const [page, setPage] = useState(0);

  const { data } = useQuery({
    queryKey: queryKeys.infPredictions(infId, jobId, page),
    queryFn: () =>
      fetchInferencePredictions(infId, jobId, PAGE_SIZE, page * PAGE_SIZE),
  });

  if (!data) return null;

  const totalPages = Math.ceil(data.total_rows / PAGE_SIZE);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Showing {page * PAGE_SIZE + 1}--
          {Math.min((page + 1) * PAGE_SIZE, data.total_rows)} of{" "}
          {data.total_rows}
        </span>
        <a
          href={getInferenceDownloadUrl(infId, jobId)}
          download
          className="inline-flex"
        >
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Download className="mr-1 h-3 w-3" />
            Download CSV
          </Button>
        </a>
      </div>

      <div className="max-h-80 overflow-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              {data.columns.map((col) => (
                <TableHead key={col} className="text-xs">
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((row, i) => (
              <TableRow key={`row-${page * PAGE_SIZE + i}`}>
                {data.columns.map((col) => (
                  <TableCell key={col} className="text-xs">
                    {formatCell(row[col])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  return String(value);
}
