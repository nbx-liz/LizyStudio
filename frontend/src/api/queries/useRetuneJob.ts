import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type RetuneRequestBody, retuneJob } from "@/api/jobs";
import { queryKeys } from "../queryKeys";

export interface RetuneJobVariables {
  jobId: string;
  body: RetuneRequestBody;
}

/**
 * Start a Re-tune child job. On success, invalidates both the job
 * list and the parent's detail cache so the child appears immediately
 * and the parent's lineage view refreshes.
 */
export function useRetuneJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: RetuneJobVariables) => retuneJob(jobId, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.job(variables.jobId),
      });
    },
  });
}
