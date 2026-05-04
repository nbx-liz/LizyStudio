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
import { useCallback, useRef } from "react";
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
  const { progress, foldLog, clearProgress } = useJobProgress({
    jobId,
    job,
    onTerminal,
    trackFoldLog,
    onWsError,
  });

  // Issue #238: ``useQueryClient`` returns the same underlying client
  // across renders but the hook's return value itself is not reference-
  // stable in every React Query version. Pin it behind a ref so the
  // cancel callback's deps are all stable.
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  // Issue #237: even when cancelJob rejects (5xx, network error), the
  // UI must not stay in "Cancelling..." forever. Run the release path
  // in finally so the parent's running flag flips and the transient
  // progress state is cleared regardless of the outcome.
  //
  // Issue #238: deps list only stable references. ``queryClientRef``
  // is a ref (stable by definition); ``clearProgress`` is memoised in
  // useJobProgress; ``refetchJob`` is stable via useQuery.
  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelJob(jobId);
      toast.info("Job cancelled");
    } catch {
      toast.error("Failed to cancel job");
    } finally {
      clearProgress();
      await refetchJob();
      queryClientRef.current.invalidateQueries({
        queryKey: queryKeys.job(jobId),
      });
      queryClientRef.current.invalidateQueries({ queryKey: queryKeys.jobs() });
      onTerminal?.();
    }
  }, [jobId, refetchJob, onTerminal, clearProgress]);

  return {
    job,
    refetchJob,
    progress,
    foldLog,
    clearProgress,
    cancel,
  };
}
