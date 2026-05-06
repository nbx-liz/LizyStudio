import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pauseJob } from "@/api/jobs";
import { queryKeys } from "../queryKeys";

/**
 * P-0099 v3-20d/f: request a running tune to pause.
 *
 * Invalidates the per-job and jobs-list queries on success so the UI
 * reflects the new ``paused`` state without waiting for the next WS
 * frame (the WS broadcaster also emits ``WsPaused``, but the cache
 * invalidation guarantees a consistent UI even when the WS is slow
 * or temporarily disconnected).
 */
export function usePauseJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => pauseJob(jobId),
    onSuccess: (_data, jobId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
      queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) });
    },
  });
}
