/**
 * Compose ``useJob`` + ``useJobProgress`` + the cancel action into the
 * single entry point that ResultsPanel and JobDetail previously
 * hand-rolled.
 *
 * Consumers pass the parent-level ``onTerminal`` callback (e.g.
 * WorkspacePage's ``onJobDone`` / JobsPage's ``onJobChanged``). When
 * the user cancels, the hook fires the cancel API, invalidates the
 * relevant caches, and calls ``onTerminal`` so the parent can update
 * its "running" flag.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { cancelJob } from "@/api/jobs";
import { queryKeys } from "@/api/queryKeys";
import { useJob } from "./useJob";
import { useJobProgress } from "./useJobProgress";

export interface UseJobLifecycleParams {
  jobId: string | null;
  onTerminal?: () => void;
  trackFoldLog?: boolean;
  onWsError?: (message: string) => void;
}

export function useJobLifecycle({
  jobId,
  onTerminal,
  trackFoldLog = false,
  onWsError,
}: UseJobLifecycleParams) {
  const queryClient = useQueryClient();
  const { data: job, refetch: refetchJob } = useJob(jobId);
  const progress = useJobProgress({
    jobId,
    job,
    onTerminal,
    trackFoldLog,
    onWsError,
  });

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelJob(jobId);
      toast.info("Job cancelled");
      progress.clearProgress();
      refetchJob();
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
      onTerminal?.();
    } catch {
      toast.error("Failed to cancel job");
    }
  }, [jobId, refetchJob, queryClient, onTerminal, progress]);

  return {
    job,
    refetchJob,
    progress: progress.progress,
    foldLog: progress.foldLog,
    clearProgress: progress.clearProgress,
    cancel,
  };
}
