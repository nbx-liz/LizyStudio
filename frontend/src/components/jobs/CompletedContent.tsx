import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  fetchJobImportance,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
} from "@/api/jobs";
import type { JobDetail } from "@/api/types";
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

interface CompletedContentProps {
  job: JobDetail;
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
}

export function CompletedContent({
  job,
  selectedPlot,
  onSelectPlot,
}: CompletedContentProps) {
  const { data: plots } = useQuery({
    queryKey: ["job-plots", job.job_id],
    queryFn: () => fetchJobPlots(job.job_id),
  });

  const { data: plotData } = useQuery({
    queryKey: ["job-plot", job.job_id, selectedPlot],
    queryFn: () => fetchJobPlot(job.job_id, selectedPlot),
    enabled: !!selectedPlot,
  });

  const { data: learningCurve } = useQuery({
    queryKey: ["job-plot", job.job_id, "learning-curve"],
    queryFn: () => fetchJobPlot(job.job_id, "learning-curve"),
    enabled: plots?.includes("learning-curve") ?? false,
  });

  const { data: importance } = useQuery({
    queryKey: ["job-importance", job.job_id],
    queryFn: () => fetchJobImportance(job.job_id),
  });

  const { data: importancePlot } = useQuery({
    queryKey: ["job-plot", job.job_id, "importance"],
    queryFn: () => fetchJobPlot(job.job_id, "importance"),
    enabled: plots?.includes("importance") ?? false,
  });

  const { data: splitSummary } = useQuery({
    queryKey: ["job-split-summary", job.job_id],
    queryFn: () => fetchJobSplitSummary(job.job_id),
  });

  const { data: tuningPlot } = useQuery({
    queryKey: ["job-plot", job.job_id, "tuning"],
    queryFn: () => fetchJobPlot(job.job_id, "tuning"),
    enabled: job.job_type === "tune",
  });

  // Auto-select first plot
  useEffect(() => {
    if (plots && plots.length > 0 && !selectedPlot) {
      const first = plots.find(
        (p) => p !== "learning-curve" && p !== "tuning" && p !== "importance",
      );
      if (first) onSelectPlot(first);
    }
  }, [plots, selectedPlot, onSelectPlot]);

  const fitResult = job.fit_result;
  const tuneResult = job.tune_result;
  const metrics = fitResult?.metrics as
    | Record<string, Record<string, number>>
    | undefined;
  const hasFolds = fitResult != null && fitResult.fold_count > 1;

  return (
    <>
      {/* Tune: Optimization History */}
      {tuneResult && tuningPlot && (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-medium">Optimization History</h4>
          <PlotlyChart plotlyJson={tuningPlot.plotly_json} />
        </section>
      )}

      {/* Tune: Best Params (no Apply to Fit button per BLUEPRINT) */}
      {tuneResult && (
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
                <TableRow key={k}>
                  <TableCell className="text-xs font-mono">{k}</TableCell>
                  <TableCell className="text-xs">{String(v)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {/* Score */}
      {metrics && (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-medium">Score</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead className="text-center">IS</TableHead>
                <TableHead className="text-center">OOS</TableHead>
                {hasFolds && (
                  <TableHead className="text-center">OOS Std</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(metrics).map(([name, vals]) => (
                <TableRow key={name}>
                  <TableCell className="font-medium text-xs">{name}</TableCell>
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
      )}

      {/* Learning Curve */}
      {learningCurve && (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-medium">Learning Curve</h4>
          <PlotlyChart plotlyJson={learningCurve.plotly_json} />
        </section>
      )}

      {/* Plots selector */}
      {plots && plots.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-sm font-medium">Plots</h4>
            <Select value={selectedPlot} onValueChange={onSelectPlot}>
              <SelectTrigger className="h-7 w-48 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {plots
                  .filter(
                    (p) =>
                      p !== "learning-curve" &&
                      p !== "tuning" &&
                      p !== "importance",
                  )
                  .map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.replace(/-/g, " ")}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {plotData && <PlotlyChart plotlyJson={plotData.plotly_json} />}
        </section>
      )}

      {/* Accordion sections */}
      <Accordion type="multiple">
        {/* Trial Results (Tune only) */}
        {tuneResult && tuneResult.trials.length > 0 && (
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
                        const rec = trial as Record<string, unknown>;
                        const trialScore = Number(rec.score ?? 0);
                        const isBest =
                          Math.abs(
                            trialScore - Number(tuneResult.best_score ?? 0),
                          ) < 1e-10;
                        return (
                          <TableRow
                            key={`trial-${i}`}
                            className={
                              isBest
                                ? "bg-green-50 dark:bg-green-950/30 font-medium"
                                : ""
                            }
                          >
                            {Object.entries(rec).map(([k, v], j) => (
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
        )}

        {/* Feature Importance */}
        {(importancePlot || importance) && (
          <AccordionItem value="importance">
            <AccordionTrigger>Feature Importance</AccordionTrigger>
            <AccordionContent>
              {importancePlot ? (
                <PlotlyChart plotlyJson={importancePlot.plotly_json} />
              ) : importance ? (
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
                      .slice(0, 20)
                      .map(([name, val]) => (
                        <TableRow key={name}>
                          <TableCell className="text-xs">{name}</TableCell>
                          <TableCell className="text-right text-xs">
                            {val.toFixed(4)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              ) : null}
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
                    <TableRow key={`fold-${i}`}>
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
        {fitResult && fitResult.params.length > 0 && (
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
                      <TableRow key={`param-${i}-${k}`}>
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
      </Accordion>
    </>
  );
}

function formatNum(v: unknown): string {
  if (typeof v !== "number") return String(v ?? "");
  return v.toFixed(4);
}
