import { Download } from "lucide-react";
import { useEffect } from "react";
import type { LineageNode } from "@/api/jobs";
import { useJobLineage } from "@/api/queries";
import type { JobDetail } from "@/api/types";
import { JobLineageTree } from "@/components/retune/JobLineageTree";
import { RetuneActionButton } from "@/components/retune/RetuneActionButton";
import { JobResultsBody } from "@/components/shared/JobResultsBody";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useJobResultData } from "@/hooks/useJobResultData";
import { defaultRetuneTrials } from "@/lib/job-config";
import { ConfigDiffBadge } from "./ConfigDiffBadge";

interface ResultsCompletedViewProps {
  job: JobDetail;
  headerLabel: string;
  modelName?: string;
  currentConfig?: Record<string, unknown>;
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  onApplyToFit?: (params: Record<string, unknown>) => void;
  /** Called when a Re-tune child job is successfully started (H-0062). */
  onJobStarted?: (childJobId: string) => void;
}

export function ResultsCompletedView({
  job,
  headerLabel,
  modelName,
  currentConfig,
  selectedPlot,
  onSelectPlot,
  onJobStarted,
  onApplyToFit,
}: ResultsCompletedViewProps) {
  const data = useJobResultData({ job, selectedPlot });
  const { plots, metrics } = data;

  // H-0062 acceptance #13: lineage tree wire-in. Only fetch for tune jobs;
  // silently swallow errors because lineage is auxiliary information.
  const { data: lineageData } = useJobLineage(job.job_id, {
    enabled: job.job_type === "tune",
  });
  const lineageRoot: LineageNode | null = lineageData?.tree ?? null;
  const showLineage =
    lineageRoot != null &&
    (lineageRoot.children.length > 0 || job.parent_job_id != null);

  useEffect(() => {
    if (plots && plots.length > 0 && !selectedPlot) {
      const first = plots.find((p) => p !== "tuning");
      if (first) onSelectPlot(first);
    }
  }, [plots, selectedPlot, onSelectPlot]);

  const tuneResult = job.tune_result;
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
        <Badge variant="default" className="bg-success text-success-fg">
          Completed
        </Badge>
        {primaryMetric && <Badge variant="secondary">{primaryMetric}</Badge>}
        <ConfigDiffBadge
          jobConfig={(job.config ?? {}) as Record<string, unknown>}
          currentConfig={currentConfig}
        />
        <div className="ml-auto flex gap-2">
          {job.job_type === "tune" && tuneResult && (
            <RetuneActionButton
              jobId={job.job_id}
              defaultNTrials={defaultRetuneTrials(job)}
              onStarted={onJobStarted}
            />
          )}
          <Button
            variant="default"
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

      {/* H-0062 #13: Job lineage tree (only when relations exist).
          onJobStarted is reused as the node-select handler — the parent
          WorkspacePage treats it as "switch workspace selection to job_id",
          which is exactly the behavior we want when clicking a tree node. */}
      {showLineage && lineageRoot && (
        <div className="mb-3">
          <JobLineageTree root={lineageRoot} onSelect={onJobStarted} />
        </div>
      )}

      <JobResultsBody
        job={job}
        selectedPlot={selectedPlot}
        onSelectPlot={onSelectPlot}
        data={data}
        onApplyToFit={onApplyToFit}
      />
    </div>
  );
}
