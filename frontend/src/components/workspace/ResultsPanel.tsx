import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, X } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { CompletedView } from "./CompletedView";

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
