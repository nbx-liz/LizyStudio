import {
  ArrowRight,
  Download,
  ExternalLink,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { LineageNode } from "@/api/jobs";
import { useJobLineage, useJobLog, useJobsInvalidator } from "@/api/queries";
import type { JobDetail as JobDetailType, ProgressMessage } from "@/api/types";
import { JobLineageTree } from "@/components/retune/JobLineageTree";
import { ResumeActionButton } from "@/components/retune/ResumeActionButton";
import { RetuneActionButton } from "@/components/retune/RetuneActionButton";
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
import { useJobLifecycle } from "@/hooks/useJobLifecycle";
import {
  defaultRetuneTrials,
  getModelName,
  remainingRetuneTrials,
} from "@/lib/job-config";
import { CompletedContent } from "./CompletedContent";
import { ConfigTreeView } from "./ConfigTreeView";
import { DeleteDialog } from "./DeleteDialog";
import { ExportDialog } from "./ExportDialog";
import { PauseActionButton } from "./PauseActionButton";
import { UnpauseActionButton } from "./UnpauseActionButton";

interface JobDetailProps {
  jobId: string;
  jobNumber: number;
  onJobDeleted: () => void;
  onJobChanged: () => void;
  /**
   * H-0067: switch the Jobs-page left-panel selection to *newJobId*.
   * Fired when the user clicks a node in the Lineage tree or right
   * after a Re-tune / Resume starts (so the new child becomes the
   * focused job without leaving the Jobs page).
   */
  onJobSelect?: (newJobId: string) => void;
}

export function JobDetailPanel({
  jobId,
  jobNumber,
  onJobDeleted,
  onJobChanged,
  onJobSelect,
}: JobDetailProps) {
  const navigate = useNavigate();
  const invalidateJobs = useJobsInvalidator();
  const [selectedPlot, setSelectedPlot] = useState<string>("");
  const [logOpen, setLogOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const onTerminal = useCallback(() => {
    onJobChanged();
  }, [onJobChanged]);

  const onWsError = useCallback((message: string) => {
    toast.error(message);
  }, []);

  const { job, progress, cancel } = useJobLifecycle({
    jobId,
    onTerminal,
    onWsError,
  });

  // H-0067: Re-tune / Resume / Lineage in the Jobs page. Lineage is
  // auxiliary info — swallow errors silently. Only fetch for tune
  // jobs because only tune jobs can have a lineage.
  const { data: lineageData } = useJobLineage(jobId, {
    enabled: job?.job_type === "tune",
  });
  const lineageRoot: LineageNode | null = lineageData?.tree ?? null;
  const showLineage =
    lineageRoot != null &&
    (lineageRoot.children.length > 0 || job?.parent_job_id != null);
  // descendantCount counts nodes strictly under the current job
  // (excluding the current job itself). Used by DeleteDialog to
  // show the cascade checkbox only when it makes a difference.
  const descendantCount = lineageRoot
    ? _countDescendants(lineageRoot, jobId)
    : 0;

  const handleRetuneStarted = useCallback(
    (childJobId: string) => {
      // Invalidate the list so the new child shows up immediately in
      // the left panel, then switch selection to it.
      invalidateJobs();
      onJobSelect?.(childJobId);
    },
    [invalidateJobs, onJobSelect],
  );

  const modelName = getModelName(job) || undefined;

  const handleCancel = useCallback(async () => {
    await cancel();
    setCancelConfirm(false);
  }, [cancel]);

  const handleRefit = useCallback(() => {
    // Navigate to workspace with job config
    navigate("/", { state: { refitJobId: jobId } });
  }, [navigate, jobId]);

  const handleOpenInWorkspace = useCallback(() => {
    // Issue #101: hydrate the Workspace with this job selected so the
    // user can see its Results panel, Re-tune button, lineage panel,
    // etc. WorkspacePage reads the ?job_id= query param (see
    // WorkspacePage.tsx). This is the first-party way to "promote" a
    // historical job back into the live editing surface — before this,
    // the Workspace only ever hosted the latest fit / tune started via
    // its own UI. encodeURIComponent keeps this robust if job ids ever
    // start carrying reserved URL characters.
    navigate(`/?job_id=${encodeURIComponent(jobId)}`);
  }, [navigate, jobId]);

  const handleInference = useCallback(() => {
    navigate(`/inference?job_id=${encodeURIComponent(jobId)}`);
  }, [navigate, jobId]);

  if (!job) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  const typeLabel = job.job_type === "fit" ? "Fit" : "Tune";
  const headerLabel = `${typeLabel} #${jobNumber}`;
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";
  const isRunning = job.status === "running";
  const isCancelled = job.status === "cancelled";
  // P-0099 v3-20f: paused is non-terminal — the job still owns the
  // workspace's training slot and can be resumed in place via
  // POST /api/jobs/{id}/unpause OR cancelled outright.
  const isPaused = job.status === "paused";

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <JobHeader
          headerLabel={headerLabel}
          modelName={modelName}
          status={job.status}
          job={job}
        />

        {/* Running state */}
        {isRunning && <RunningView job={job} progress={progress} />}

        {/* Failed state */}
        {isFailed && (
          <FailedView job={job} onViewLog={() => setLogOpen(true)} />
        )}

        {/* Cancelled state */}
        {isCancelled && (
          <p className="text-sm text-muted-foreground">
            This job was cancelled before completion.
          </p>
        )}

        {/* Paused state — non-terminal; the user must click Resume or
         Cancel to free the workspace's training slot. */}
        {isPaused && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="paused-notice"
          >
            This tune is paused. Click <strong>Resume</strong> to continue from
            the next trial, or <strong>Cancel</strong> to discard.
          </p>
        )}

        {/* Completed state */}
        {isCompleted && (
          <CompletedContent
            job={job}
            selectedPlot={selectedPlot}
            onSelectPlot={setSelectedPlot}
          />
        )}

        {/* Config + Execution Log + Lineage accordions (all states) */}
        <Accordion type="multiple" className="mt-4">
          <AccordionItem value="config">
            <AccordionTrigger>Config</AccordionTrigger>
            <AccordionContent>
              <div className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                <ConfigTreeView data={job.config} />
              </div>
            </AccordionContent>
          </AccordionItem>
          {isCompleted && !isRunning && (
            <AccordionItem value="execution-log">
              <AccordionTrigger>Execution Log</AccordionTrigger>
              <AccordionContent>
                <ExecutionLogContent jobId={job.job_id} />
              </AccordionContent>
            </AccordionItem>
          )}
          {/* H-0067: Lineage tree. Only show when relations exist
           so jobs with no parent / no children do not render an
           empty accordion. Clicking a node switches the left-panel
           selection (onJobSelect prop). */}
          {showLineage && lineageRoot && (
            <AccordionItem value="lineage">
              <AccordionTrigger>Lineage</AccordionTrigger>
              <AccordionContent>
                <JobLineageTree
                  root={lineageRoot}
                  onSelect={(newJobId) => onJobSelect?.(newJobId)}
                />
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 border-t px-6 py-3">
        {isCompleted && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInWorkspace}
              data-testid="open-in-workspace"
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              Open in Workspace
            </Button>
            <Button variant="outline" size="sm" onClick={handleInference}>
              <ArrowRight className="mr-1 h-3 w-3" />
              Inference
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportOpen(true)}
            >
              <Download className="mr-1 h-3 w-3" />
              Export
            </Button>
          </>
        )}
        {(isCompleted || isFailed) && (
          <Button variant="outline" size="sm" onClick={handleRefit}>
            <RotateCcw className="mr-1 h-3 w-3" />
            Re-fit
          </Button>
        )}
        {/* H-0067: Re-tune for completed tune jobs (continue the
         Optuna study for +N trials). Mirrors the Workspace-side
         button in ResultsCompletedView so users can launch the
         same action from the Jobs history. */}
        {isCompleted && job.job_type === "tune" && (
          <RetuneActionButton
            jobId={job.job_id}
            defaultNTrials={defaultRetuneTrials(job)}
            onStarted={handleRetuneStarted}
          />
        )}
        {/* H-0067: Resume for failed tune jobs. The "re-tune child
         cannot be resumed" constraint from H-0062 is preserved. */}
        {isFailed && job.job_type === "tune" && (
          <ResumeActionButton
            jobId={job.job_id}
            remainingTrials={remainingRetuneTrials(job)}
            disabledReason={
              job.parent_job_id
                ? "Resume of a re-tune child is not supported. Start from the original parent job."
                : null
            }
            onStarted={handleRetuneStarted}
          />
        )}
        {/* P-0099 v3-20f: Pause for running tune jobs. Pause is a
         tune-only action — fit jobs are short-running by design and
         have no useful resume target. */}
        {isRunning && job.job_type === "tune" && (
          <PauseActionButton jobId={job.job_id} />
        )}
        {/* P-0099 v3-20f: Resume + Cancel for paused tune jobs. The
         user is reminded by HTTP 400 + JOB_NOT_PAUSED that the
         resume action is in-place (same job_id), distinct from the
         /resume child-job lineage on failed parents. */}
        {isPaused && job.job_type === "tune" && (
          <>
            <UnpauseActionButton jobId={job.job_id} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelConfirm(true)}
            >
              <X className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          </>
        )}
        {isRunning && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelConfirm(true)}
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        )}
        {!isRunning && !isPaused && (
          // text-danger-fg maps onto --lzs-danger-fg (hsl(0 63% 31%)
          // light / hsl(0 94% 75%) dark), which matches the previous
          // red-700/red-400 pair and preserves WCAG 2 AA contrast
          // against the outline button surface (the default
          // text-destructive token at hsl(0 84.2% 60.2%) was only
          // 3.76:1 and axe flagged it as a serious violation — #168
          // scope expansion).
          <Button
            variant="outline"
            size="sm"
            className="ml-auto text-danger-fg hover:text-danger-fg"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
        )}
      </div>

      {/* Dialogs */}
      <Dialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel job?</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {isPaused
              ? "Are you sure you want to cancel this paused job? The saved Optuna study will be discarded."
              : "Are you sure you want to cancel this running job?"}
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

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        jobId={jobId}
        jobNumber={jobNumber}
      />

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        jobId={jobId}
        jobNumber={jobNumber}
        onDeleted={onJobDeleted}
        descendantCount={descendantCount}
      />

      <LogDialog open={logOpen} onOpenChange={setLogOpen} jobId={job.job_id} />
    </div>
  );
}

function JobHeader({
  headerLabel,
  modelName,
  status,
  job,
}: {
  headerLabel: string;
  modelName?: string;
  status: string;
  job: JobDetailType;
}) {
  const primaryMetric = getPrimaryMetric(job);

  return (
    <div className="mb-4 flex items-center gap-2">
      <h3 className="text-lg font-medium">
        {headerLabel} {modelName && `\u2014 ${modelName}`}
      </h3>
      <StatusBadge status={status} />
      {primaryMetric && <Badge variant="secondary">{primaryMetric}</Badge>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      // bg-success-solid maps onto --lzs-success-solid-bg (#15803d,
      // green-700 equivalent) which keeps WCAG 2 AA contrast (~4.5:1)
      // against white; the previous bg-green-600 scored only 3.29:1
      // (Issue #168).
      return (
        <Badge
          variant="default"
          className="bg-success-solid text-success-solid-fg"
        >
          {"\u2713"} Completed
        </Badge>
      );
    case "running":
      return <Badge variant="secondary">Running</Badge>;
    case "failed":
      return <Badge variant="destructive">{"\u2717"} Failed</Badge>;
    case "cancelled":
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getPrimaryMetric(job: JobDetailType): string | null {
  if (job.status !== "completed") return null;
  const { tune_result: tuneResult, fit_result: fitResult } = job;
  if (tuneResult) {
    return `${tuneResult.metric_name}: ${Number(tuneResult.best_score ?? 0).toFixed(4)}`;
  }
  const metrics = fitResult?.metrics as
    | Record<string, Record<string, number>>
    | undefined;
  if (metrics) {
    const firstKey = Object.keys(metrics)[0];
    const oos = metrics[firstKey]?.oos;
    return firstKey && oos != null
      ? `${firstKey}: ${Number(oos).toFixed(4)}`
      : null;
  }
  return null;
}

function RunningView({
  job,
  progress,
}: {
  job: JobDetailType;
  progress: ProgressMessage | null;
}) {
  const indeterminate = progress != null && progress.total === 0;
  const pct =
    progress && progress.total > 0
      ? (progress.current / progress.total) * 100
      : 0;
  const isTune = job.job_type === "tune";

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">Progress</h4>
      {isTune && progress && progress.total > 0 && (
        <p className="mb-1 text-sm">
          Trial {progress.current} / {progress.total}
        </p>
      )}
      <Progress
        value={indeterminate ? undefined : pct}
        className={`mb-2${indeterminate ? " animate-pulse" : ""}`}
      />
      {!isTune && (
        <p className="mb-1 text-sm">{progress?.message ?? "Fitting..."}</p>
      )}
      {/*
        H-0069: the previous implementation dereferenced
        `progress.elapsed` / `progress.metrics`, but the backend never
        emits those fields on WsProgress.  The dead branches were
        removed when the schema was unified to the Pydantic SSOT.
      */}
    </div>
  );
}

function FailedView({
  job,
  onViewLog,
}: {
  job: JobDetailType;
  onViewLog: () => void;
}) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">Error</h4>
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm font-mono">{job.error ?? "Unknown error"}</p>
      </div>
      <Button variant="outline" size="sm" className="mt-3" onClick={onViewLog}>
        View Full Log
      </Button>
    </div>
  );
}

function ExecutionLogContent({ jobId }: { jobId: string }) {
  const { data } = useJobLog(jobId, { enabled: true });

  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs font-mono">
      {data?.log ?? "Loading..."}
    </pre>
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
          {data?.log ?? "Loading..."}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Count lineage nodes strictly under *rootJobId* (the clicked job).
 * The lineage tree may be rooted at an ancestor (H-0062: lineage is
 * rooted at the oldest ancestor), so we first locate the node whose
 * ``job_id === rootJobId`` and then tally all nodes below it.
 */
function _countDescendants(tree: LineageNode, rootJobId: string): number {
  const node = _findNode(tree, rootJobId);
  if (!node) return 0;
  let count = 0;
  const stack: LineageNode[] = [...node.children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    count += 1;
    stack.push(...current.children);
  }
  return count;
}

function _findNode(tree: LineageNode, jobId: string): LineageNode | null {
  if (tree.job_id === jobId) return tree;
  for (const child of tree.children) {
    const hit = _findNode(child, jobId);
    if (hit) return hit;
  }
  return null;
}
