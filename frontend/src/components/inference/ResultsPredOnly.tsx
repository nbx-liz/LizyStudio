import { useState } from "react";
import type { ComparisonStats, InferenceRecord } from "@/api/inference";
import {
  useInferenceComparison,
  useInferencePlot,
  useInferenceShap,
  useJobPlots,
} from "@/api/queries";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { PlotlyChart } from "@/components/workspace/PlotlyChart";
import { formatNum } from "@/lib/utils";
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

  const compareInfNumber = compareInfId
    ? (() => {
        const idx = history.findIndex((r) => r.inf_id === compareInfId);
        return idx >= 0 ? history.length - idx : 0;
      })()
    : 0;

  const { data: comparison } = useInferenceComparison(
    record.inf_id,
    compareInfId || null,
    record.job_id,
  );

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

      {/* Prediction Distribution */}
      <section className="mb-6">
        <h4 className="mb-2 text-sm font-medium">Prediction Distribution</h4>
        <PredDistributionPlot infId={record.inf_id} jobId={record.job_id} />
      </section>

      {/* Comparison */}
      {otherRecords.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-sm font-medium">Comparison</h4>
            <Select value={compareInfId} onValueChange={setCompareInfId}>
              <SelectTrigger
                aria-label="Compare past inference"
                className="h-7 w-64 text-xs"
              >
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
              otherLabel={`Inf #${compareInfNumber}`}
            />
          )}
        </section>
      )}

      {/* SHAP + Warnings accordions */}
      <ShapAndWarningsAccordion
        infId={record.inf_id}
        jobId={record.job_id}
        warnings={record.warnings}
      />
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

/** Prediction distribution plot section. */
function PredDistributionPlot({
  infId,
  jobId,
}: {
  infId: string;
  jobId: string;
}) {
  const { data, isLoading } = useInferencePlot(
    infId,
    jobId,
    "prediction-distribution",
    { retry: false },
  );

  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground">Loading distribution...</p>
    );
  }
  if (!data) return null;
  return <PlotlyChart plotlyJson={data.plotly_json} />;
}

/** SHAP summary + warnings as accordion sections. */
function ShapAndWarningsAccordion({
  infId,
  jobId,
  warnings,
}: {
  infId: string;
  jobId: string;
  warnings: string[];
}) {
  // Issue #355: gate SHAP fetch on the backend's available_plots so
  // we never request a plot the backend cannot render (which would
  // log a 404 in the browser console on every Inference run).
  const { data: availablePlots } = useJobPlots(jobId);
  const shapAvailable = availablePlots?.includes("shap-summary") ?? false;
  const { data: shapData, isLoading: shapLoading } = useInferenceShap(
    infId,
    jobId,
    { retry: false, enabled: shapAvailable },
  );

  const hasShap = shapData != null || shapLoading;
  const hasWarnings = warnings.length > 0;

  if (!hasShap && !hasWarnings) return null;

  return (
    <Accordion type="multiple">
      {hasShap && (
        <AccordionItem value="shap-summary">
          <AccordionTrigger>SHAP Summary</AccordionTrigger>
          <AccordionContent>
            {shapLoading ? (
              <p className="text-xs text-muted-foreground">
                Loading SHAP summary...
              </p>
            ) : shapData ? (
              <PlotlyChart plotlyJson={shapData.plotly_json} />
            ) : null}
          </AccordionContent>
        </AccordionItem>
      )}

      {hasWarnings && (
        <AccordionItem value="warnings">
          <AccordionTrigger>Warnings</AccordionTrigger>
          <AccordionContent>
            <ul className="list-disc pl-4 text-sm text-degraded-fg">
              {warnings.map((w, i) => (
                <li key={`warn-${i}`}>{w}</li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );
}
