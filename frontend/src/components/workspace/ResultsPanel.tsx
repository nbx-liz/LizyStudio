import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Download, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  cancelJob,
  fetchJob,
  fetchJobImportance,
  fetchJobImportanceKinds,
  fetchJobLog,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
  fetchJobs,
} from "@/api/jobs";
import type {
  JobDetail,
  MetricEntry,
  ProgressMessage,
  TrialResult,
} from "@/api/types";
import { connectJobProgress } from "@/api/websocket";
import { MetricCards } from "@/components/shared/MetricCards";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { pivotMetrics } from "@/lib/metrics";
import { formatElapsed } from "@/lib/utils";
import { FoldDetailsSection } from "./FoldDetailsSection";
import { FoldProgressList } from "./FoldProgressList";
import { PlotlyChart } from "./PlotlyChart";
import { PlotSection } from "./PlotSection";
import {
  TrialResultsAccordionItem,
  TuneTrialsSection,
} from "./TuneTrialsSection";

interface ResultsPanelProps {
  jobId: string | null;
  hasData?: boolean;
  hasConfig?: boolean;
  onApplyToFit?: (params: Record<string, unknown>) => void;
  onJobDone?: () => void;
}

export function ResultsPanel({
  jobId,
  hasData = false,
  hasConfig = false,
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
      const s = data?.status;
      return s === "running" || s === "pending" ? 2000 : false;
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

  useEffect(() => {
    if (!jobId || (job?.status !== "running" && job?.status !== "pending"))
      return;

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
        queryClient.invalidateQueries({ queryKey: ["job", jobId] });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        onJobDone?.();
      },
      onError: (msg) => {
        setProgress(null);
        setFoldLog([]);
        toast.error(msg.message);
        queryClient.invalidateQueries({ queryKey: ["job", jobId] });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        onJobDone?.();
      },
    });

    return () => disconnect();
  }, [jobId, job?.status, queryClient, onJobDone]);

  // Polling fallback: detect completion if WebSocket misses it
  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = job?.status;
    if (
      (prev === "running" || prev === "pending") &&
      job?.status &&
      job.status !== "running" &&
      job.status !== "pending"
    ) {
      setProgress(null);
      onJobDone?.();
    }
  }, [job?.status, onJobDone]);

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelJob(jobId);
      toast.info("Job cancelled");
      setProgress(null);
      setFoldLog([]);
      refetchJob();
      onJobDone?.();
    } catch {
      toast.error("Failed to cancel job");
    }
    setCancelConfirm(false);
  }, [jobId, refetchJob, onJobDone]);

  if (!jobId || !job) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 pb-24 text-center text-muted-foreground">
        <Activity className="mb-3 h-10 w-10 text-muted-foreground/50" />
        <h3 className="mb-4 text-lg font-medium">Results</h3>
        <ol className="space-y-2.5 text-sm text-left">
          <li className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${hasData ? "bg-primary text-primary-foreground" : "border border-muted-foreground/40"}`}
              role="img"
              aria-label={hasData ? "Completed" : "Step 1"}
            >
              {hasData ? "✓" : "1"}
            </span>
            <span
              className={hasData ? "text-muted-foreground/60 line-through" : ""}
            >
              Load data in the Data Panel
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${hasConfig ? "bg-primary text-primary-foreground" : "border border-muted-foreground/40"}`}
              role="img"
              aria-label={hasConfig ? "Completed" : "Step 2"}
            >
              {hasConfig ? "✓" : "2"}
            </span>
            <span
              className={
                hasConfig ? "text-muted-foreground/60 line-through" : ""
              }
            >
              Configure model settings
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-muted-foreground/40 text-xs font-medium">
              3
            </span>
            <span>Click Fit or Tune</span>
          </li>
        </ol>
        <p className="mt-4 text-xs">
          Results will appear here after running a job.
        </p>
      </div>
    );
  }

  const typeLabel = job.job_type === "fit" ? "Fit" : "Tune";
  const headerLabel = `${typeLabel}${jobNumber ? ` #${jobNumber}` : ""}`;

  if (job.status === "pending") {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <Badge
          variant="secondary"
          className="mb-3 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
        >
          Queued
        </Badge>
        <p className="text-sm">Job queued, starting soon...</p>
      </div>
    );
  }

  if (job.status === "running") {
    const indeterminate = progress != null && progress.total === 0;
    const pct =
      progress && progress.total > 0
        ? (progress.current / progress.total) * 100
        : 0;
    return (
      <div className="flex h-full flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">
              {headerLabel} {modelName && `\u2014 ${modelName}`}
            </h3>
          </div>
          <Badge
            variant="secondary"
            className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
          >
            Running
          </Badge>
        </div>

        <Progress
          value={indeterminate ? undefined : pct}
          className={`mb-2${indeterminate ? " animate-pulse" : ""}`}
        />
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

        {progress?.fold_results && progress.fold_results.length > 0 && (
          <FoldProgressList
            currentFold={progress.current}
            totalFolds={progress.total}
            foldResults={progress.fold_results}
          />
        )}

        {progress?.trial_results && progress.trial_results.length > 1 && (
          <LiveTrialChart trials={progress.trial_results} />
        )}

        {progress?.trial_results && progress.trial_results.length > 0 && (
          <div className="mt-3 max-h-48 overflow-auto rounded border bg-muted/30">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">#</th>
                  <th className="px-2 py-1 text-left font-medium">Score</th>
                  <th className="px-2 py-1 text-left font-medium">Best</th>
                  <th className="px-2 py-1 text-left font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {[...progress.trial_results].reverse().map((t) => (
                  <tr
                    key={t.number}
                    className="border-t border-muted hover:bg-muted/50"
                  >
                    <td className="px-2 py-0.5 font-mono">{t.number}</td>
                    <td className="px-2 py-0.5 font-mono">
                      {t.score != null ? t.score.toFixed(4) : "—"}
                    </td>
                    <td className="px-2 py-0.5 font-mono">
                      {t.best_score?.toFixed(4) ?? "—"}
                    </td>
                    <td className="px-2 py-0.5">{t.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {foldLog.length > 0 && (
          <div
            className="mt-3 min-h-16 max-h-[50vh] overflow-auto rounded border bg-muted/30 p-2 resize-y"
            style={{ height: "8rem" }}
          >
            {foldLog.map((msg, i) => (
              <p
                key={`log-${i}`}
                className="font-mono text-xs text-muted-foreground"
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

  if (job.status === "cancelled") {
    return (
      <div className="flex h-full flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium">
            {headerLabel} {modelName && `\u2014 ${modelName}`}
          </h3>
          <Badge
            variant="secondary"
            className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
          >
            Cancelled
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          This job was cancelled before completion.
        </p>
      </div>
    );
  }

  return (
    <CompletedView
      key={job.job_id}
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

  const {
    data: plotData,
    isLoading: isPlotLoading,
    isError: isPlotError,
  } = useQuery({
    queryKey: ["job-plot", job.job_id, selectedPlot],
    queryFn: () => fetchJobPlot(job.job_id, selectedPlot),
    enabled:
      !!selectedPlot &&
      selectedPlot !== "learning-curve" &&
      selectedPlot !== "importance",
    retry: false,
  });

  // Learning curve metrics filter (H-0034)
  // Default to first metric only to avoid cramped subplots when multiple exist
  const [lcMetric, setLcMetric] = useState<string | null>(null);
  const lcInitialized = useRef(false);

  const { data: learningCurve, isError: isLcError } = useQuery({
    queryKey: ["job-plot", job.job_id, "learning-curve", lcMetric],
    queryFn: () =>
      fetchJobPlot(job.job_id, "learning-curve", {
        metrics: lcMetric ?? undefined,
      }),
    enabled:
      selectedPlot === "learning-curve" &&
      (plots?.includes("learning-curve") ?? false),
    retry: false,
  });

  // If LC filter fails (e.g. feval-only metric), fall back to unfiltered view
  useEffect(() => {
    if (isLcError && lcMetric !== null) {
      setLcMetric(null);
    }
  }, [isLcError, lcMetric]);

  const [importanceKind, setImportanceKind] = useState("split");
  const importanceEnabled = plots?.includes("importance") ?? false;

  const { data: importanceKinds } = useQuery({
    queryKey: ["job-importance-kinds", job.job_id],
    queryFn: () => fetchJobImportanceKinds(job.job_id),
    enabled: importanceEnabled,
  });

  // Sync initial kind with backend response when it differs
  useEffect(() => {
    if (
      importanceKinds &&
      importanceKinds.length > 0 &&
      !importanceKinds.includes(importanceKind)
    ) {
      setImportanceKind(importanceKinds[0]);
    }
  }, [importanceKinds, importanceKind]);

  const { data: importance } = useQuery({
    queryKey: ["job-importance", job.job_id, importanceKind],
    queryFn: () => fetchJobImportance(job.job_id, importanceKind),
    enabled: importanceEnabled,
  });

  const { data: importancePlot, isLoading: isImportancePlotLoading } = useQuery(
    {
      queryKey: ["job-plot", job.job_id, "importance", importanceKind],
      queryFn: () =>
        fetchJobPlot(job.job_id, "importance", { kind: importanceKind }),
      enabled: importanceEnabled,
    },
  );

  const { data: splitSummary } = useQuery({
    queryKey: ["job-split-summary", job.job_id],
    queryFn: () => fetchJobSplitSummary(job.job_id),
  });

  const { data: tuningPlot } = useQuery({
    queryKey: ["job-plot", job.job_id, "tuning"],
    queryFn: () => fetchJobPlot(job.job_id, "tuning"),
    enabled: job.job_type === "tune",
  });

  useEffect(() => {
    if (plots && plots.length > 0 && !selectedPlot) {
      const first = plots.find((p) => p !== "tuning");
      if (first) onSelectPlot(first);
    }
  }, [plots, selectedPlot, onSelectPlot]);

  const fitResult = job.fit_result;
  const tuneResult = job.tune_result;
  const metrics = fitResult?.metrics
    ? pivotMetrics(fitResult.metrics as Record<string, unknown>)
    : undefined;

  // evalConfig is used by annotateMetric() for precision_at_k k-value display.
  const evalConfig = (job.config?.evaluation as Record<string, unknown>) ?? {};

  // LC filter uses model.params.metric (LightGBM internal metric names)
  // which match the subplot titles in the learning curve plot.
  // If metric is unset in job config (e.g. legacy jobs), lcAvailableMetrics
  // is empty and the filter is hidden — all subplots are shown unfiltered.
  const modelConfig = (job.config?.model as Record<string, unknown>) ?? {};
  const lcAvailableMetrics = useMemo(() => {
    const m = (modelConfig.params as Record<string, unknown>)?.metric;
    if (Array.isArray(m)) return m as string[];
    if (typeof m === "string") return [m];
    return [];
  }, [modelConfig.params]);

  // Initialize LC filter to first metric (avoid cramped subplots).
  // When only 1 metric exists, lcMetric stays null (no filter needed).
  useEffect(() => {
    if (lcInitialized.current) return;
    if (lcAvailableMetrics.length > 1) {
      lcInitialized.current = true;
      setLcMetric(lcAvailableMetrics[0]);
    } else if (lcAvailableMetrics.length >= 1) {
      lcInitialized.current = true;
    }
  }, [lcAvailableMetrics]);

  const annotateMetric = (name: string): string => {
    if (name === "precision_at_k") {
      // Look for MetricEntry dict form in evaluation.metrics
      const entries = Array.isArray(evalConfig.metrics)
        ? (evalConfig.metrics as MetricEntry[])
        : [];
      for (const entry of entries) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          "precision_at_k" in entry
        ) {
          const k = entry.precision_at_k?.k;
          return typeof k === "number" ? `${name}@${k}` : name;
        }
      }
    }
    return name;
  };
  const hasFolds = fitResult != null && fitResult.fold_count > 1;

  const primaryMetric = tuneResult
    ? `${tuneResult.metric_name}: ${Number(tuneResult.best_score ?? 0).toFixed(4)}`
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
    <div className="h-full min-w-0 overflow-auto p-6">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-lg font-medium">
          {headerLabel} {modelName && `\u2014 ${modelName}`}
        </h3>
        <Badge
          variant="default"
          className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
        >
          Completed
        </Badge>
        {primaryMetric && <Badge variant="secondary">{primaryMetric}</Badge>}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.open(`/api/jobs/${job.job_id}/export-code`, "_blank");
            }}
          >
            <Download className="mr-1 h-3 w-3" />
            Export Code
          </Button>
        </div>
      </div>

      {/* Tune results first: Optimization History → Best Params → Apply to Fit */}
      {tuneResult && (
        <TuneTrialsSection
          tuneResult={tuneResult}
          tuningPlot={tuningPlot}
          job={job}
          onApplyToFit={onApplyToFit}
        />
      )}

      {/* KPI Summary Cards (IS + OOS + Std) */}
      {metrics && (
        <MetricCards
          metrics={metrics}
          hasFolds={hasFolds}
          annotateMetric={annotateMetric}
        />
      )}

      {/* Learning Curve + Plot selector */}
      {plots && plots.length > 0 && (
        <PlotSection
          plots={plots}
          selectedPlot={selectedPlot}
          onSelectPlot={onSelectPlot}
          plotData={plotData}
          learningCurve={learningCurve}
          isLoading={
            selectedPlot === "importance"
              ? isImportancePlotLoading
              : isPlotLoading
          }
          isError={isPlotError}
          lcMetric={lcMetric}
          onLcMetricChange={setLcMetric}
          availableEvalMetrics={lcAvailableMetrics}
          importanceKinds={importanceKinds}
          selectedImportanceKind={importanceKind}
          onImportanceKindChange={setImportanceKind}
          importanceData={importance}
          importancePlot={importancePlot}
        />
      )}

      {/* Accordion sections */}
      <Accordion type="multiple">
        {tuneResult && <TrialResultsAccordionItem tuneResult={tuneResult} />}

        {fitResult && (
          <FoldDetailsSection
            fitResult={fitResult}
            hasFolds={hasFolds}
            splitSummary={splitSummary}
          />
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
          {data?.log ?? "Loading log..."}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Live Trial Chart — Optimization History during tuning
// ---------------------------------------------------------------------------

function LiveTrialChart({ trials }: { trials: TrialResult[] }) {
  const plotlyJson = useMemo(() => {
    const valid = trials.filter((t) => t.score != null);
    if (valid.length < 2) return null;
    const x = valid.map((t) => t.number);
    const scores = valid.map((t) => t.score);
    const best = valid.map((t) => t.best_score ?? t.score);
    return JSON.stringify({
      data: [
        {
          x,
          y: scores,
          mode: "markers",
          type: "scatter",
          name: "Score",
          marker: { size: 5, opacity: 0.6 },
        },
        {
          x,
          y: best,
          mode: "lines",
          type: "scatter",
          name: "Best",
          line: { width: 2 },
        },
      ],
      layout: {
        height: 180,
        margin: { t: 10, r: 10, b: 30, l: 50 },
        xaxis: { title: "Trial" },
        yaxis: { title: "Score" },
        showlegend: false,
      },
    });
  }, [trials]);

  if (!plotlyJson) return null;

  return (
    <div className="mt-3 rounded border bg-muted/30 p-1">
      <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">
        Optimization History
      </p>
      <PlotlyChart plotlyJson={plotlyJson} height={180} />
    </div>
  );
}
