/**
 * Single source of truth for the "get one job with live-polling while
 * running" query. Previously ResultsPanel and JobDetail each owned a
 * near-identical ``useQuery(queryKeys.job(id), ...)`` with a polling
 * ``refetchInterval`` that stopped once the job reached a terminal
 * state — and the two had already drifted (ResultsPanel polled on
 * running OR pending; JobDetail only on running).
 */

import { useQuery } from "@tanstack/react-query";
import { fetchJob } from "@/api/jobs";
import { queryKeys } from "@/api/queryKeys";
import type { JobDetail } from "@/api/types";

const POLL_INTERVAL_MS = 2000;

export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: () => fetchJob(jobId as string),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data as JobDetail | undefined;
      const s = data?.status;
      return s === "running" || s === "pending" ? POLL_INTERVAL_MS : false;
    },
  });
}
