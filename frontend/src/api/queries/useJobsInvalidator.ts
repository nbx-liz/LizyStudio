import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "../queryKeys";

/**
 * Helper for mutation callbacks that need to invalidate the job list
 * after a write (cancel / delete / retune / resume). Encapsulates the
 * ``queryClient.invalidateQueries({ queryKey: queryKeys.jobs() })``
 * boilerplate that was repeated at 8+ call sites before B-7.
 */
export function useJobsInvalidator(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
  }, [queryClient]);
}
