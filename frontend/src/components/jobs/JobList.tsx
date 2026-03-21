import { useMemo, useState } from "react";
import type { JobSummary } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "completed" | "running" | "failed";
type TypeFilter = "all" | "fit" | "tune";

const STATUS_FILTERS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Done", value: "completed" },
  { label: "Run", value: "running" },
  { label: "Fail", value: "failed" },
];

interface JobListProps {
  jobs: JobSummary[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
}

function getStatusIcon(status: string): { icon: string; className: string } {
  switch (status) {
    case "completed":
      return { icon: "\u2713", className: "text-green-600" };
    case "running":
      return { icon: "\u25CF", className: "text-blue-500 animate-pulse" };
    case "failed":
      return { icon: "\u2717", className: "text-red-500" };
    case "cancelled":
      return { icon: "\u2717", className: "text-muted-foreground" };
    default:
      return { icon: "\u25CB", className: "text-muted-foreground" };
  }
}

function shortenModelName(name: string | undefined): string {
  if (!name) return "???";
  const map: Record<string, string> = {
    LightGBM: "LGB",
    XGBoost: "XGB",
    RandomForest: "RF",
    CatBoost: "CB",
    LogisticRegression: "LR",
  };
  return map[name] ?? name.slice(0, 6);
}

function getJobScore(job: JobSummary): string {
  if (job.status === "running") return "...";
  if (job.status === "failed" || job.status === "cancelled") return "\u2014";
  if (job.primary_score != null) return job.primary_score.toFixed(3);
  return "\u2014";
}

function getJobNumber(job: JobSummary, allJobs: JobSummary[]): number {
  // Jobs are sorted newest first; job number = total - index
  const idx = allJobs.findIndex((j) => j.job_id === job.job_id);
  return allJobs.length - idx;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

export function JobList({ jobs, selectedJobId, onSelectJob }: JobListProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (typeFilter !== "all" && job.job_type !== typeFilter) return false;
      return true;
    });
  }, [jobs, statusFilter, typeFilter]);

  return (
    <div className="flex h-full flex-col border-r">
      {/* Header */}
      <div className="space-y-3 border-b p-4">
        <h2 className="text-lg font-semibold">Jobs</h2>

        {/* Status filter - segmented control */}
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={statusFilter === f.value ? "default" : "outline"}
              size="sm"
              className="h-7 flex-1 px-2 text-xs"
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {/* Type filter */}
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as TypeFilter)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="fit">Fit</SelectItem>
            <SelectItem value="tune">Tune</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Job list */}
      <ScrollArea className="flex-1">
        {filteredJobs.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {jobs.length === 0
              ? "No jobs yet. Run Fit or Tune from the Workspace."
              : "No jobs match the current filters."}
          </div>
        ) : (
          <div className="p-2">
            <TooltipProvider>
              {filteredJobs.map((job) => {
                const { icon, className: iconClass } = getStatusIcon(
                  job.status,
                );
                const num = getJobNumber(job, jobs);
                const modelName = (
                  job.config?.model as Record<string, unknown> | undefined
                )?.name as string | undefined;
                const shortModel = shortenModelName(modelName);
                const score = getJobScore(job);
                const isSelected = job.job_id === selectedJobId;

                return (
                  <Tooltip key={job.job_id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                          isSelected && "bg-accent",
                        )}
                        onClick={() => onSelectJob(job.job_id)}
                      >
                        <span className={cn("font-mono text-sm", iconClass)}>
                          {icon}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          #{num}
                        </span>
                        <Badge
                          variant={
                            job.job_type === "fit" ? "default" : "secondary"
                          }
                          className={cn(
                            "h-5 px-1.5 text-[10px]",
                            job.job_type === "tune" &&
                              "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
                          )}
                        >
                          {job.job_type === "fit" ? "fit" : "tun"}
                        </Badge>
                        <span
                          className="truncate text-xs"
                          title={modelName ?? ""}
                        >
                          {shortModel}
                        </span>
                        <span className="ml-auto text-xs font-mono text-muted-foreground">
                          {score}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>
                        {formatTimeAgo(job.created_at)} (
                        {formatTimestamp(job.created_at)})
                      </p>
                      {modelName && <p>Model: {modelName}</p>}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </TooltipProvider>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
