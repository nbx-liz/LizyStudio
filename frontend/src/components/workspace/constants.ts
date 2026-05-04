/**
 * Pure UI presets that are not driven by the backend UiSchema response.
 *
 * @see H-0026 in HISTORY.md for the UiSchema contract.
 *
 * Historical notes:
 *  - KNOWN_PARAMS / RANGE_DEFAULTS removed in H-0053 (adapter-driven now).
 *  - METRICS_BY_TASK removed in H-0074 (UiSchema option_sets.metric is the
 *    sole source of task-to-metric mapping; MetricsChips renders empty
 *    until UiSchema loads).
 *  - CV_STRATEGY_FIELDS removed in H-0076 (UiSchema
 *    capabilities.cv_strategy_fields is the sole source; cv-state.ts and
 *    CvSection.tsx receive the field list via prop / argument).
 */

/** Default calibration config when toggled ON. */
export const CALIBRATION_DEFAULTS = {
  method: "isotonic",
  n_splits: 5,
  params: {},
} as const;

/** Preset choices for Tune Settings SegmentedControls. */
export const N_TRIALS_PRESETS = [10, 50, 100, 200, 500] as const;
export const TIMEOUT_PRESETS = [
  { label: "None", value: null },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
  { label: "30m", value: 1800 },
] as const;

/** Display labels for CV strategies (from capabilities.cv_strategies) */
export const CV_STRATEGY_LABELS: Record<string, string> = {
  kfold: "KFold",
  stratified_kfold: "StratifiedKFold",
  group_kfold: "GroupKFold",
  stratified_group_kfold: "StratifiedGroup",
  time_series: "TimeSeriesSplit",
  purged_time_series: "PurgedTimeSeries",
  group_time_series: "GroupTimeSeries",
  blocked_group_kfold: "BlockedGroup",
};

/** Default CV strategy per task type. */
export function getDefaultCvStrategy(task: string): string {
  return task === "binary" || task === "multiclass"
    ? "stratified_kfold"
    : "kfold";
}
