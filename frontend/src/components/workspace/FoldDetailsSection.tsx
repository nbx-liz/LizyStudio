import type {
  FitResult,
  ImportanceResponse,
  PlotResponse,
  SplitSummaryRow,
} from "@/api/types";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlotlyChart } from "./PlotlyChart";

interface FoldDetailsSectionProps {
  fitResult: FitResult;
  hasFolds: boolean;
  splitSummary: SplitSummaryRow[] | undefined;
  importance: ImportanceResponse | undefined;
  importancePlot: PlotResponse | undefined;
}

/**
 * Accordion items for Feature Importance, Fold Details, and Parameters.
 * Must be rendered as a child of an Accordion component.
 */
export function FoldDetailsSection({
  fitResult,
  hasFolds,
  splitSummary,
  importance,
  importancePlot,
}: FoldDetailsSectionProps) {
  return (
    <>
      {/* Feature Importance */}
      {(importancePlot || importance) && (
        <AccordionItem value="importance">
          <AccordionTrigger>Feature Importance</AccordionTrigger>
          <AccordionContent>
            {importancePlot && (
              <div className="mb-4">
                <PlotlyChart plotlyJson={importancePlot.plotly_json} />
              </div>
            )}
            {importance && Object.keys(importance).length > 0 && (
              <div className="lzs-scrollable max-h-64 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feature</TableHead>
                      <TableHead className="text-right">Importance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(importance)
                      .sort(([, a], [, b]) => b - a)
                      .map(([name, val]) => (
                        <TableRow
                          key={name}
                          className="hover:bg-muted/50 even:bg-muted/20"
                        >
                          <TableCell className="text-sm">{name}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {val.toFixed(4)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Fold Details (CV only) */}
      {hasFolds && splitSummary && splitSummary.length > 0 && (
        <AccordionItem value="folds">
          <AccordionTrigger>Fold Details</AccordionTrigger>
          <AccordionContent>
            <Table>
              <TableHeader>
                <TableRow>
                  {Object.keys(splitSummary[0]).map((k) => (
                    <TableHead key={k} className="text-xs">
                      {k}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {splitSummary.map((row, i) => (
                  <TableRow
                    key={`fold-${i}`}
                    className="hover:bg-muted/50 even:bg-muted/20"
                  >
                    {Object.values(row).map((v, j) => (
                      <TableCell key={`cell-${j}`} className="text-xs">
                        {typeof v === "number" ? formatNum(v) : String(v)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Parameters */}
      {fitResult.params.length > 0 && (
        <AccordionItem value="params">
          <AccordionTrigger>Parameters</AccordionTrigger>
          <AccordionContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Param</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fitResult.params.map((row, i) =>
                  Object.entries(row).map(([k, v]) => (
                    <TableRow
                      key={`param-${i}-${k}`}
                      className="hover:bg-muted/50 even:bg-muted/20"
                    >
                      <TableCell className="text-xs font-mono">{k}</TableCell>
                      <TableCell className="text-xs">{String(v)}</TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>
      )}
    </>
  );
}

function formatNum(v: unknown): string {
  if (typeof v !== "number") return String(v ?? "");
  return v.toFixed(4);
}
