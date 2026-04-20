import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ResumeRequestBody, resumeJob } from "@/api/jobs";
import { queryKeys } from "../queryKeys";

export interface ResumeJobVariables {
  jobId: string;
  body: ResumeRequestBody;
}

/**
 * Resume a FAILED tune job. Same invalidation semantics as Re-tune.
 */
export function useResumeJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: ResumeJobVariables) => resumeJob(jobId, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
      queryClient.invalidateQueries({
        queryKey: queryKeys.job(variables.jobId),
      });
    },
  });
}
