import { ArrowRight } from "lucide-react";
import type { JobDetail, PlotResponse, TuneResult } from "@/api/types";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNum } from "@/lib/utils";
import { PlotlyChart } from "./PlotlyChart";

interface TuneTrialsSectionProps {
  tuneResult: TuneResult;
  tuningPlot: PlotResponse | undefined;
  job: JobDetail;
  onApplyToFit?: (params: Record<string, unknown>) => void;
}

/** Renders optimization history plot, best params table, and Apply to Fit button. */
export function TuneTrialsSection({
  tuneResult,
  tuningPlot,
  job,
  onApplyToFit,
}: TuneTrialsSectionProps) {
  return (
    <>
      {/* Optimization History */}
      {tuningPlot && (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-medium">Optimization History</h4>
          <PlotlyChart plotlyJson={tuningPlot.plotly_json} />
        </section>
      )}

      {/* Best Params */}
      <section className="mb-6">
        <h4 className="mb-2 text-sm font-medium">Best Params</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Param</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(tuneResult.best_params).map(([k, v]) => (
              <TableRow key={k} className="hover:bg-muted/50 even:bg-muted/20">
                <TableCell className="text-xs font-mono">{k}</TableCell>
                <TableCell className="text-xs">{String(v)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {onApplyToFit && (
          <Button
            size="sm"
            className="mt-3"
            onClick={() => {
              // Restore full config snapshot with best_params applied,
              // stripping the tuning section (not needed for fit).
              const { tuning: _stripped, ...baseWithoutTuning } =
                (job.config as Record<string, unknown>) ?? {};
              const baseModel =
                (baseWithoutTuning.model as Record<string, unknown>) ?? {};
              const fitConfig: Record<string, unknown> = {
                ...baseWithoutTuning,
                model: {
                  ...baseModel,
                  params: {
                    ...((baseModel.params as Record<string, unknown>) ?? {}),
                    ...tuneResult.best_params,
                  },
                },
              };
              onApplyToFit(fitConfig);
            }}
          >
            Apply to Fit
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </section>
    </>
  );
}

interface TrialResultsAccordionItemProps {
  tuneResult: TuneResult;
}

/** Accordion item showing sorted trial results table. Must be a child of Accordion. */
export function TrialResultsAccordionItem({
  tuneResult,
}: TrialResultsAccordionItemProps) {
  if (tuneResult.trials.length === 0) return null;

  return (
    <AccordionItem value="trials">
      <AccordionTrigger>Trial Results</AccordionTrigger>
      <AccordionContent>
        <div className="max-h-64 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {Object.keys(tuneResult.trials[0]).map((k) => (
                  <TableHead key={k} className="text-xs">
                    {k}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...tuneResult.trials]
                .sort((a, b) => {
                  const ra = a as Record<string, unknown>;
                  const rb = b as Record<string, unknown>;
                  const sa = Number(ra.score ?? 0);
                  const sb = Number(rb.score ?? 0);
                  return tuneResult.direction === "maximize"
                    ? sb - sa
                    : sa - sb;
                })
                .map((trial, i) => {
                  const trialRecord = trial as Record<string, unknown>;
                  const trialScore = Number(trialRecord.score ?? 0);
                  const isBest =
                    Math.abs(trialScore - Number(tuneResult.best_score ?? 0)) <
                    1e-10;
                  return (
                    <TableRow
                      key={`trial-${i}`}
                      className={
                        isBest
                          ? "bg-green-50 dark:bg-green-950/30 font-medium"
                          : "hover:bg-muted/50 even:bg-muted/20"
                      }
                    >
                      {Object.entries(trialRecord).map(([k, v], j) => (
                        <TableCell key={`cell-${j}`} className="text-xs">
                          {k === "trial" && isBest
                            ? `\u2605 ${String(v)}`
                            : typeof v === "number"
                              ? formatNum(v)
                              : String(v)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
