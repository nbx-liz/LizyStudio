import { useMutation, useQueryClient } from "@tanstack/react-query";
import { runInference } from "@/api/inference";
import { queryKeys } from "../queryKeys";

type RunInferenceParams = Parameters<typeof runInference>[0];

/**
 * Run inference on a completed job. Invalidates the full inference
 * history tree so every per-job cache re-fetches its list.
 */
export function useRunInference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: RunInferenceParams) => runInference(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.infHistoryAll() });
    },
  });
}
