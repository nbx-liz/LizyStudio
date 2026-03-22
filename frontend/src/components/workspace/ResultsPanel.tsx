import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Download, X } from "lucide-react";
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
import { FoldDetailsSection } from "./FoldDetailsSection";
import { PlotSection } from "./PlotSection";
import { ScoreSection } from "./ScoreSection";
import {
  TrialResultsAccordionItem,
  TuneTrialsSection,
} from "./TuneTrialsSection";

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

  // Polling fallback: detect completion if WebSocket misses it
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

  if (!jobId || !job) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <Activity className="mb-3 h-10 w-10 text-muted-foreground/50" />
        <h3 className="mb-4 text-lg font-medium">Results</h3>
        <ol className="space-y-2 text-sm">
          <li>1. Load data in the Data Panel</li>
          <li>2. Select a model in the Model Panel</li>
          <li>3. Click Fit or Tune</li>
        </ol>
        <p className="mt-4 text-xs">
          Results will appear here after running a job.
        </p>
      </div>
    );
  }

  const typeLabel = job.job_type === "fit" ? "Fit" : "Tune";
  const headerLabel = `${typeLabel}${jobNumber ? ` #${jobNumber}` : ""}`;

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
          <Badge
            variant="secondary"
            className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
          >
            Running
          </Badge>
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

  const evalConfig = (job.config?.evaluation as Record<string, unknown>) ?? {};
  const annotateMetric = (name: string): string => {
    if (name === "precision_at_k") {
      const k = evalConfig.precision_at_k;
      return typeof k === "number" ? `${name}@${k}` : name;
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
    <div className="h-full overflow-auto p-6">
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

      {tuneResult && (
        <TuneTrialsSection
          tuneResult={tuneResult}
          tuningPlot={tuningPlot}
          job={job}
          onApplyToFit={onApplyToFit}
        />
      )}

      {/* Score */}
      {metrics && (
        <ScoreSection
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
            importance={importance}
            importancePlot={importancePlot}
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

function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
