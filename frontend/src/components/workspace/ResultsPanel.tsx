import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cancelJob, fetchJob, fetchJobLog, fetchJobs } from "@/api/jobs";
import type { JobDetail, ProgressMessage } from "@/api/types";
import { connectJobProgress } from "@/api/websocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResultsCompletedView } from "./ResultsCompletedView";
import { ResultsRunningView } from "./ResultsRunningView";
import { ResumeActionButton } from "./retune/ResumeActionButton";

interface ResultsPanelProps {
  jobId: string | null;
  hasData?: boolean;
  hasConfig?: boolean;
  onApplyToFit?: (params: Record<string, unknown>) => void;
  onJobDone?: () => void;
  /**
   * Called when a Re-tune / Resume child job has been created so the
   * parent (WorkspacePage) can switch its selection over to the child
   * and surface its progress (H-0062).
   */
  onJobStarted?: (childJobId: string) => void;
}

export function ResultsPanel({
  jobId,
  hasData = false,
  hasConfig = false,
  onApplyToFit,
  onJobDone,
  onJobStarted,
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
    if (!jobId) return;
    // H-0062: allow WebSocket to start even when job is still undefined
    // (child job just selected but its first fetch has not resolved).
    // If the job is already terminal we still skip — no progress to
    // subscribe to. When the job is undefined, optimistically connect
    // so a fast-completing re-tune child does not lose its events.
    if (job?.status && job.status !== "running" && job.status !== "pending")
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

  // Polling fallback: detect completion if WebSocket misses it.
  // H-0062: also handle the "jobId changed and the child is already
  // completed / failed / cancelled" case, which happens when the
  // backend finishes a short re-tune before the frontend could even
  // subscribe. In that case prev was undefined (fresh selection) and
  // we still need to flip running=false on the WorkspacePage.
  const prevStatusRef = useRef<string | undefined>(undefined);
  const prevJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset the cached status whenever the selected job id changes so
    // a transition from one job to another is not misread as a status
    // transition on the same job.
    if (prevJobIdRef.current !== jobId) {
      prevJobIdRef.current = jobId;
      prevStatusRef.current = undefined;
    }
    const prev = prevStatusRef.current;
    prevStatusRef.current = job?.status;
    const reached_terminal =
      job?.status === "completed" ||
      job?.status === "failed" ||
      job?.status === "cancelled";
    if (!reached_terminal) return;
    // Only notify when we transition TO a terminal state from a
    // non-terminal one, OR when this is the first observation of a
    // job that is already terminal (child selection edge case).
    if (prev === undefined || prev === "running" || prev === "pending") {
      setProgress(null);
      onJobDone?.();
    }
  }, [jobId, job?.status, onJobDone]);

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
              {hasData ? "\u2713" : "1"}
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
              {hasConfig ? "\u2713" : "2"}
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
    return (
      <ResultsRunningView
        headerLabel={headerLabel}
        modelName={modelName}
        progress={progress}
        foldLog={foldLog}
        cancelConfirm={cancelConfirm}
        onCancelConfirmChange={setCancelConfirm}
        onCancel={handleCancel}
      />
    );
  }

  if (job.status === "failed") {
    const remaining = _computeRemainingTrials(job);
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
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setLogOpen(true)}>
            View Full Log
          </Button>
          {job.job_type === "tune" && (
            <ResumeActionButton
              jobId={job.job_id}
              remainingTrials={remaining}
              disabledReason={
                job.parent_job_id
                  ? "Resume of a re-tune child is not supported. Start from the original parent job."
                  : null
              }
              onStarted={onJobStarted}
            />
          )}
        </div>
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
    <ResultsCompletedView
      key={job.job_id}
      job={job}
      headerLabel={headerLabel}
      modelName={modelName}
      selectedPlot={selectedPlot}
      onSelectPlot={setSelectedPlot}
      onApplyToFit={onApplyToFit}
      onJobStarted={onJobStarted}
    />
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

/** H-0062: compute remaining trials for a failed tune job's Resume dialog. */
function _computeRemainingTrials(job: JobDetail): number {
  const config = job.config as Record<string, unknown> | undefined;
  const tuning = config?.tuning as Record<string, unknown> | undefined;
  const optuna = tuning?.optuna as Record<string, unknown> | undefined;
  const params = optuna?.params as Record<string, unknown> | undefined;
  const originalRaw = params?.n_trials;
  const original =
    typeof originalRaw === "number" && originalRaw > 0 ? originalRaw : 50;
  const tuneResult = job.tune_result as
    | { trials?: unknown[] | null }
    | null
    | undefined;
  const completed = Array.isArray(tuneResult?.trials)
    ? (tuneResult?.trials?.length ?? 0)
    : 0;
  return Math.max(1, original - completed);
}
