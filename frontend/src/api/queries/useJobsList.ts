import { useQuery } from "@tanstack/react-query";
import { fetchJobs } from "@/api/jobs";
import { queryKeys } from "../queryKeys";

/**
 * Job list query — single source of truth for the Workspace / Jobs /
 * Inference page job dropdowns.
 *
 * ``refetchInterval`` is intentionally not set here. Consumers that
 * need a live list (JobsPage) set ``refetchInterval`` themselves via
 * useQuery options. Most consumers rely on mutation-driven
 * invalidation via ``useJobsInvalidator``.
 */
export function useJobsList(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: queryKeys.jobs(),
    queryFn: () => fetchJobs(),
    refetchInterval: options?.refetchInterval,
  });
}
