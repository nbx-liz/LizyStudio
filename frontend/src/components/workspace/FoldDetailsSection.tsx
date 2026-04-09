import type { FitResult, SplitSummaryRow } from "@/api/types";
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
import { formatNum } from "@/lib/utils";

interface FoldDetailsSectionProps {
  fitResult: FitResult;
  hasFolds: boolean;
  splitSummary: SplitSummaryRow[] | undefined;
}

/**
 * Accordion items for Feature Importance, Fold Details, and Parameters.
 * Must be rendered as a child of an Accordion component.
 */
export function FoldDetailsSection({
  fitResult,
  hasFolds,
  splitSummary,
}: FoldDetailsSectionProps) {
  return (
    <>
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
                {fitResult.params.map((row, i) => (
                  <TableRow
                    key={`param-${i}`}
                    className="hover:bg-muted/50 even:bg-muted/20"
                  >
                    <TableCell className="text-xs font-mono">
                      {String(row.parameter ?? "")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {typeof row.value === "number"
                        ? formatNum(row.value)
                        : String(row.value ?? "")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>
      )}
    </>
  );
}
