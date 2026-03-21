import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  cancelJob,
  fetchJob,
  fetchJobImportance,
  fetchJobLog,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
  fetchJobs,
} from "@/api/jobs";
import type { JobDetail, ProgressMessage } from "@/api/types";
import { connectJobProgress } from "@/api/websocket";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
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
import { PlotlyChart } from "./PlotlyChart";

interface ResultsPanelProps {
  jobId: string | null;
  onApplyToFit?: (params: Record<string, unknown>) => void;
  onJobDone?: () => void;
}

export function ResultsPanel({
  jobId,
  onApplyToFit,
  onJobDone,
}: ResultsPanelProps) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ProgressMessage | null>(null);
  const [foldLog, setFoldLog] = useState<string[]>([]);
  const [selectedPlot, setSelectedPlot] = useState<string>("");
  const [logOpen, setLogOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const { data: job, refetch: refetchJob } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId as string),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data as JobDetail | undefined;
      return data?.status === "running" ? 2000 : false;
    },
  });

  const { data: allJobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => fetchJobs(),
    enabled: !!jobId,
  });

  // Compute #N
  const jobNumber =
    job && allJobs
      ? allJobs.length - allJobs.findIndex((j) => j.job_id === job.job_id)
      : null;

  const modelName = (job?.config?.model as Record<string, unknown>)?.name as
    | string
    | undefined;

  // WebSocket progress — simplified cleanup (no disconnectRef)
  useEffect(() => {
    if (!jobId || job?.status !== "running") return;

    const disconnect = connectJobProgress(jobId, {
      onProgress: (msg) => {
        setProgress(msg);
        if (msg.message) {
          setFoldLog((prev) => {
            const last = prev[prev.length - 1];
            if (last === msg.message) return prev;
            return [...prev, msg.message as string];
          });
        }
      },
      onCompleted: () => {
        setProgress(null);
        setFoldLog([]);
        refetchJob();
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        onJobDone?.();
      },
      onError: (msg) => {
        setProgress(null);
        setFoldLog([]);
        toast.error(msg.message);
        refetchJob();
        onJobDone?.();
      },
    });

    return () => disconnect();
  }, [jobId, job?.status, refetchJob, queryClient, onJobDone]);

  // Polling fallback: detect job completion even if WebSocket fails.
  // Only fires when progress is still set (WebSocket did not already handle it).
  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = job?.status;
    if (
      prev === "running" &&
      job?.status &&
      job.status !== "running" &&
      job.status !== "pending" &&
      progress !== null
    ) {
      setProgress(null);
      onJobDone?.();
    }
  }, [job?.status, onJobDone, progress]);

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelJob(jobId);
      toast.info("Job cancelled");
      refetchJob();
    } catch {
      toast.error("Failed to cancel job");
    }
    setCancelConfirm(false);
  }, [jobId, refetchJob]);

  // Empty state
  if (!jobId || !job) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <h3 className="mb-4 text-lg font-medium">Results</h3>
        <ol className="space-y-2 text-sm">
          <li>1. Load data in the Data Panel</li>
          <li>2. Select a model in the Model Panel</li>
          <li>3. Click Fit or Tune</li>
        </ol>
        <p className="mt-4 text-xs">Results will appear here</p>
      </div>
    );
  }

  const typeLabel = job.job_type === "fit" ? "Fit" : "Tune";
  const headerLabel = `${typeLabel}${jobNumber ? ` #${jobNumber}` : ""}`;

  // Running state
  if (job.status === "running") {
    const pct = progress ? (progress.current / progress.total) * 100 : 0;
    return (
      <div className="flex h-full flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">
              {headerLabel} {modelName && `\u2014 ${modelName}`}
            </h3>
          </div>
          <Badge variant="secondary">Running</Badge>
        </div>

        <Progress value={pct} className="mb-2" />
        {progress && (
          <p className="mb-1 text-sm">
            {progress.message ?? `${progress.current} / ${progress.total}`}
          </p>
        )}
        {progress?.elapsed != null && (
          <p className="text-xs text-muted-foreground">
            Elapsed: {formatElapsed(progress.elapsed)}
          </p>
        )}

        {/* Fold / Trial log */}
        {foldLog.length > 0 && (
          <div className="mt-3 max-h-32 overflow-auto rounded border bg-muted/30 p-2">
            {foldLog.map((msg, i) => (
              <p
                key={`log-${i}`}
                className="text-xs font-mono text-muted-foreground"
              >
                {msg}
              </p>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelConfirm(true)}
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        </div>

        {/* Cancel confirm dialog */}
        <Dialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel job?</DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              Are you sure you want to cancel this running job?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCancelConfirm(false)}>
                No
              </Button>
              <Button variant="destructive" onClick={handleCancel}>
                Yes, Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Failed state
  if (job.status === "failed") {
    return (
      <div className="flex h-full flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium">
            {headerLabel} {modelName && `\u2014 ${modelName}`}
          </h3>
          <Badge variant="destructive">Failed</Badge>
        </div>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
          {job.error_code && (
            <p className="mb-1 text-sm font-bold font-mono">{job.error_code}</p>
          )}
          <p className="text-sm font-mono">{job.error ?? "Unknown error"}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-fit"
          onClick={() => setLogOpen(true)}
        >
          View Full Log
        </Button>
        <LogDialog
          open={logOpen}
          onOpenChange={setLogOpen}
          jobId={job.job_id}
        />
      </div>
    );
  }

  // Cancelled state
  if (job.status === "cancelled") {
    return (
      <div className="flex h-full flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium">
            {headerLabel} {modelName && `\u2014 ${modelName}`}
          </h3>
          <Badge variant="secondary">Cancelled</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          This job was cancelled before completion.
        </p>
      </div>
    );
  }

  // Completed state
  return (
    <CompletedView
      job={job}
      headerLabel={headerLabel}
      modelName={modelName}
      selectedPlot={selectedPlot}
      onSelectPlot={setSelectedPlot}
      onApplyToFit={onApplyToFit}
    />
  );
}

function CompletedView({
  job,
  headerLabel,
  modelName,
  selectedPlot,
  onSelectPlot,
  onApplyToFit,
}: {
  job: JobDetail;
  headerLabel: string;
  modelName?: string;
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  onApplyToFit?: (params: Record<string, unknown>) => void;
}) {
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
      const first = plots.find((p) => p !== "learning-curve" && p !== "tuning");
      if (first) onSelectPlot(first);
    }
  }, [plots, selectedPlot, onSelectPlot]);

  const fitResult = job.fit_result;
  const tuneResult = job.tune_result;
  const metrics = fitResult?.metrics as
    | Record<string, Record<string, number>>
    | undefined;
  const hasFolds = fitResult && fitResult.fold_count > 1;

  // Primary metric for header badge
  const primaryMetric = tuneResult
    ? `${tuneResult.metric_name}: ${tuneResult.best_score.toFixed(4)}`
    : metrics
      ? (() => {
          const firstKey = Object.keys(metrics)[0];
          const oos = metrics[firstKey]?.oos;
          return firstKey && oos != null
            ? `${firstKey}: ${Number(oos).toFixed(4)}`
            : null;
        })()
      : null;

  return (
    <div className="h-full overflow-auto p-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-lg font-medium">
          {headerLabel} {modelName && `\u2014 ${modelName}`}
        </h3>
        <Badge variant="default" className="bg-green-600">
          Completed
        </Badge>
        {primaryMetric && <Badge variant="secondary">{primaryMetric}</Badge>}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              toast.info("Export Code will be available in H-0027");
            }}
          >
            <Download className="mr-1 h-3 w-3" />
            Export Code
          </Button>
        </div>
      </div>

      {/* Tune: Optimization History */}
      {tuneResult && tuningPlot && (
        <section className="mb-6">
          <h4 className="mb-2 text-sm font-medium">Optimization History</h4>
          <PlotlyChart plotlyJson={tuningPlot.plotly_json} />
        </section>
      )}

      {/* Tune: Best Params */}
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
          {onApplyToFit && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => onApplyToFit(tuneResult.best_params)}
            >
              Apply to Fit
            </Button>
          )}
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
                  .filter((p) => p !== "learning-curve" && p !== "tuning")
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
        {/* Trial Results (Tune only) — BLUEPRINT order: before Feature Importance */}
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
                        const sa = (a as Record<string, unknown>)
                          .score as number;
                        const sb = (b as Record<string, unknown>)
                          .score as number;
                        return tuneResult.direction === "maximize"
                          ? sb - sa
                          : sa - sb;
                      })
                      .map((trial, i) => {
                        const trialRecord = trial as Record<string, unknown>;
                        const trialScore = trialRecord.score as number;
                        const isBest =
                          Math.abs(trialScore - tuneResult.best_score) < 1e-10;
                        return (
                          <TableRow
                            key={`trial-${i}`}
                            className={
                              isBest
                                ? "bg-green-50 dark:bg-green-950/30 font-medium"
                                : ""
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
    </div>
  );
}

function LogDialog({
  open,
  onOpenChange,
  jobId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
}) {
  const { data } = useQuery({
    queryKey: ["job-log", jobId],
    queryFn: () => fetchJobLog(jobId),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Execution Log</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-4 text-xs font-mono">
          {data?.log ?? "Loading..."}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

function formatNum(v: unknown): string {
  if (typeof v !== "number") return String(v ?? "");
  return v.toFixed(4);
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
