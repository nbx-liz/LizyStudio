/**
 * Thin query/mutation hooks that shield consumers from the raw
 * ``@/api/*`` fetcher modules. See docs/coupling-analysis.md B-7.
 */

// Files
export { useFiles } from "./useFiles";
// Inference family
export {
  type ComparisonStats,
  type InferenceRecord,
  useInferenceComparison,
  useInferenceHistory,
  useInferenceMetrics,
  useInferencePlot,
  useInferencePredictions,
  useInferenceRecord,
  useInferenceShap,
} from "./useInference";
// Jobs family
export { useJob } from "./useJob";
export { useJobLineage } from "./useJobLineage";
export { useJobLog } from "./useJobLog";
export { useJobPlots } from "./useJobPlots";
export { useJobsInvalidator } from "./useJobsInvalidator";
export { useJobsList } from "./useJobsList";
export { usePauseJob } from "./usePauseJob";
export { useResumeJob } from "./useResumeJob";
export { useRetuneJob } from "./useRetuneJob";
export { useRunInference } from "./useRunInference";
export { useUnpauseJob } from "./useUnpauseJob";
// Workspace config
export {
  useBackends,
  useColumns,
  useConfig,
  useConfigSchema,
  useUiSchema,
  useWorkspaceStatus,
} from "./useWorkspace";
