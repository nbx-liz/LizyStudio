import { Activity } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useJobLog, useJobsList } from "@/api/queries";
import { ResumeActionButton } from "@/components/retune/ResumeActionButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useJobLifecycle } from "@/hooks/useJobLifecycle";
import { getModelName, remainingRetuneTrials } from "@/lib/job-config";
import { ResultsCompletedView } from "./ResultsCompletedView";
import { ResultsRunningView } from "./ResultsRunningView";

interface ResultsPanelProps {
  jobId: string | null;
  hasData?: boolean;
  hasConfig?: boolean;
  currentConfig?: Record<string, unknown>;
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
  currentConfig,
  onApplyToFit,
  onJobDone,
  onJobStarted,
}: ResultsPanelProps) {
  const [selectedPlot, setSelectedPlot] = useState<string>("");
  const [logOpen, setLogOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const onTerminal = useCallback(() => {
    onJobDone?.();
  }, [onJobDone]);

  const onWsError = useCallback((message: string) => {
    toast.error(message);
  }, []);

  const { job, progress, foldLog, cancel } = useJobLifecycle({
    jobId,
    onTerminal,
    trackFoldLog: true,
    onWsError,
  });

  const { data: allJobs } = useJobsList();

  // Compute #N
  const jobNumber =
    job && allJobs
      ? allJobs.length - allJobs.findIndex((j) => j.job_id === job.job_id)
      : null;

  const modelName = getModelName(job) || undefined;

  const handleCancel = useCallback(async () => {
    await cancel();
    setCancelConfirm(false);
  }, [cancel]);

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
    const remaining = remainingRetuneTrials(job);
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
      currentConfig={currentConfig}
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
  const { data } = useJobLog(jobId, { enabled: open });

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
