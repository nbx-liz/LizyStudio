import { useQuery } from "@tanstack/react-query";
import { fetchJobLineage } from "@/api/jobs";
import { queryKeys } from "../queryKeys";

/**
 * Fetch a job's lineage tree. Lineage is auxiliary info — callers
 * typically swallow errors silently so this hook disables retries.
 */
export function useJobLineage(jobId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.jobLineage(jobId),
    queryFn: () => fetchJobLineage(jobId),
    enabled: options?.enabled !== false,
    retry: false,
  });
}
