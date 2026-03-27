import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Download,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cancelJob, fetchJob, fetchJobLog } from "@/api/jobs";
import type { JobDetail as JobDetailType, ProgressMessage } from "@/api/types";
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
import { CompletedContent } from "./CompletedContent";
import { DeleteDialog } from "./DeleteDialog";
import { ExportDialog } from "./ExportDialog";

interface JobDetailProps {
  jobId: string;
  jobNumber: number;
  onJobDeleted: () => void;
  onJobChanged: () => void;
}

export function JobDetailPanel({
  jobId,
  jobNumber,
  onJobDeleted,
  onJobChanged,
}: JobDetailProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ProgressMessage | null>(null);
  const [selectedPlot, setSelectedPlot] = useState<string>("");
  const [logOpen, setLogOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: job, refetch: refetchJob } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId),
    refetchInterval: (query) => {
      const data = query.state.data as JobDetailType | undefined;
      return data?.status === "running" ? 2000 : false;
    },
  });

  const modelName = (job?.config?.model as Record<string, unknown>)?.name as
    | string
    | undefined;

  // WebSocket progress
  useEffect(() => {
    if (!jobId || job?.status !== "running") return;

    const disconnect = connectJobProgress(jobId, {
      onProgress: (msg) => setProgress(msg),
      onCompleted: () => {
        setProgress(null);
        refetchJob();
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        onJobChanged();
      },
      onError: (msg) => {
        setProgress(null);
        toast.error(msg.message);
        refetchJob();
        onJobChanged();
      },
    });

    return () => disconnect();
  }, [jobId, job?.status, refetchJob, queryClient, onJobChanged]);

  // Polling fallback
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
      onJobChanged();
    }
  }, [job?.status, onJobChanged, progress]);

  const handleCancel = useCallback(async () => {
    try {
      await cancelJob(jobId);
      toast.info("Job cancelled");
      refetchJob();
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch {
      toast.error("Failed to cancel job");
    }
    setCancelConfirm(false);
  }, [jobId, refetchJob, queryClient]);

  const handleRefit = useCallback(() => {
    // Navigate to workspace with job config
    navigate("/", { state: { refitJobId: jobId } });
  }, [navigate, jobId]);

  const handleInference = useCallback(() => {
    navigate(`/inference?job_id=${jobId}`);
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

        {/* Completed state */}
        {isCompleted && (
          <CompletedContent
            job={job}
            selectedPlot={selectedPlot}
            onSelectPlot={setSelectedPlot}
          />
        )}

        {/* Config + Execution Log accordions (all states) */}
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
        </Accordion>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 border-t px-6 py-3">
        {isCompleted && (
          <>
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
        {!isRunning && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
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
      return (
        <Badge variant="default" className="bg-green-600">
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
  const pct = progress ? (progress.current / progress.total) * 100 : 0;
  const isTune = job.job_type === "tune";

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">Progress</h4>
      {isTune && progress && (
        <p className="mb-1 text-sm">
          Trial {progress.current} / {progress.total}
        </p>
      )}
      <Progress value={pct} className="mb-2" />
      {!isTune && (
        <p className="mb-1 text-sm">{progress?.message ?? "Fitting..."}</p>
      )}
      {progress?.elapsed != null && (
        <p className="text-xs text-muted-foreground">
          Elapsed: {formatElapsed(progress.elapsed)}
        </p>
      )}
      {isTune && progress?.metrics && (
        <p className="mt-1 text-xs text-muted-foreground">
          Best so far:{" "}
          {Object.entries(progress.metrics)
            .map(([k, v]) => `${k} ${Number(v).toFixed(4)}`)
            .join(", ")}
        </p>
      )}
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
  const { data } = useQuery({
    queryKey: ["job-log", jobId],
    queryFn: () => fetchJobLog(jobId),
  });

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

function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Config Tree View                                                   */
/* ------------------------------------------------------------------ */

function ConfigTreeView({ data }: { data: unknown }) {
  if (data == null) {
    return <span className="text-muted-foreground italic">null</span>;
  }

  if (typeof data !== "object") {
    return <span className="font-mono">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="font-mono text-muted-foreground">[]</span>;
    }
    return (
      <ul className="space-y-0.5">
        {data.map((item, idx) => (
          <li key={`${idx}`} className="flex items-start gap-1">
            <span className="text-muted-foreground select-none">-</span>
            <ConfigTreeView data={item} />
          </li>
        ))}
      </ul>
    );
  }

  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="font-mono text-muted-foreground">{"{}"}</span>;
  }

  return (
    <ul className="space-y-0.5">
      {entries.map(([key, value]) => (
        <ConfigTreeNode key={key} label={key} value={value} />
      ))}
    </ul>
  );
}

function ConfigTreeNode({ label, value }: { label: string; value: unknown }) {
  const isExpandable =
    value != null && typeof value === "object" && Object.keys(value).length > 0;
  const [expanded, setExpanded] = useState(false);

  if (!isExpandable) {
    return (
      <li className="flex items-start gap-1">
        <span className="w-3.5 shrink-0" />
        <span className="font-semibold">{label}:</span>{" "}
        <ConfigTreeView data={value} />
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className="flex items-start gap-0.5 hover:bg-accent/50 rounded px-0.5 -ml-0.5"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
        )}
        <span className="font-semibold">{label}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l pl-2">
          <ConfigTreeView data={value} />
        </div>
      )}
    </li>
  );
}
