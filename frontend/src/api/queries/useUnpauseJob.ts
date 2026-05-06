import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unpauseJob } from "@/api/jobs";
import { queryKeys } from "../queryKeys";

/**
 * P-0099 v3-20d/f: re-launch a paused tune in place. The Optuna study
 * re-attaches via ``load_if_exists=True`` and continues from the next
 * trial — same ``job_id`` is preserved (in-place resume, not a child
 * job like /resume).
 */
export function useUnpauseJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => unpauseJob(jobId),
    onSuccess: (_data, jobId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
      queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) });
    },
  });
}
