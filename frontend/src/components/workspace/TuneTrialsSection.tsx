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
import type { BoundaryReport, TuneRound } from "./retune";
import { RetuneDashboard } from "./retune";

interface TuneTrialsSectionProps {
  tuneResult: TuneResult;
  tuningPlot: PlotResponse | undefined;
  job: JobDetail;
  onApplyToFit?: (params: Record<string, unknown>) => void;
}

/** Build a fit-ready config snapshot by merging best_params into model.params
 *  and stripping the tuning section (not needed for plain fit). */
function buildFitConfig(
  job: JobDetail,
  bestParams: Record<string, unknown>,
): Record<string, unknown> {
  const { tuning: _stripped, ...baseWithoutTuning } =
    (job.config as Record<string, unknown>) ?? {};
  const baseModel = (baseWithoutTuning.model as Record<string, unknown>) ?? {};
  return {
    ...baseWithoutTuning,
    model: {
      ...baseModel,
      params: {
        ...((baseModel.params as Record<string, unknown>) ?? {}),
        ...bestParams,
      },
    },
  };
}

/** Renders optimization history plot, best params table, and Apply to Fit button. */
export function TuneTrialsSection({
  tuneResult,
  tuningPlot,
  job,
  onApplyToFit,
}: TuneTrialsSectionProps) {
  // Retune data is optional in the OpenAPI-typed TuneResult. Cast to a local
  // structural type to surface rounds/boundary_report without hand-editing
  // the auto-generated API types module.
  const raw = tuneResult as unknown as {
    rounds?: TuneRound[] | null;
    boundary_report?: BoundaryReport | null;
  };
  const retuneRounds = raw.rounds ?? null;
  const retuneBoundaryReport = raw.boundary_report ?? null;

  const handleApplyToFit = onApplyToFit
    ? () => onApplyToFit(buildFitConfig(job, tuneResult.best_params))
    : undefined;

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
                <TableCell className="text-xs">
                  {typeof v === "number" ? formatNum(v) : String(v)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {handleApplyToFit && (
          <Button size="sm" className="mt-3" onClick={handleApplyToFit}>
            Apply to Fit
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </section>

      {/* Re-tune dashboard: convergence signal, round history, boundary report */}
      <RetuneDashboard
        rounds={retuneRounds}
        boundaryReport={retuneBoundaryReport}
        onApplyToFit={handleApplyToFit}
      />
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
                  // HIGH-7: key by the trial's stable number (set by
                  // Optuna) so sort order changes do not blow away row
                  // state. Fall back to a synthetic key only if number
                  // is missing on legacy payloads.
                  const trialNumber = trialRecord.number;
                  const rowKey =
                    typeof trialNumber === "number"
                      ? `trial-num-${trialNumber}`
                      : `trial-idx-${i}`;
                  return (
                    <TableRow
                      key={rowKey}
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
