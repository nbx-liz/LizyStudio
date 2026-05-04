import { useQuery } from "@tanstack/react-query";
import { fetchJobLog } from "@/api/jobs";
import { queryKeys } from "../queryKeys";

/**
 * Execution log query for a single job. Consumers typically pass
 * ``{ enabled: logDialogOpen }`` so the log is only fetched when the
 * user opens the dialog. Passing ``jobId: null`` also disables.
 */
export function useJobLog(
  jobId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.jobLog(jobId),
    queryFn: () => fetchJobLog(jobId as string),
    enabled: !!jobId && options?.enabled !== false,
  });
}
