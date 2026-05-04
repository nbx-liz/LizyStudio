import { useQuery } from "@tanstack/react-query";
import { fetchJobPlots } from "@/api/jobs";
import { queryKeys } from "../queryKeys";

/** Fetch the list of available plot types for a completed job. */
export function useJobPlots(jobId: string) {
  return useQuery({
    queryKey: queryKeys.jobPlots(jobId),
    queryFn: () => fetchJobPlots(jobId),
  });
}
