/**
 * Fallback constants for when GET /api/backends/ui-schema is not yet loaded.
 * Prefer values from the UiSchema API response.
 * @see H-0026 in HISTORY.md
 */

export interface KnownParam {
  key: string;
  type: "float" | "integer";
  default: number;
  description: string;
  step?: number;
}

/** LightGBM main hyperparameters displayed in model.params Key-Value editor. */
export const KNOWN_PARAMS: KnownParam[] = [
  {
    key: "learning_rate",
    type: "float",
    default: 0.1,
    description: "Learning rate (shrinkage)",
  },
  {
    key: "num_leaves",
    type: "integer",
    default: 31,
    description: "Maximum number of leaves per tree",
  },
  {
    key: "n_estimators",
    type: "integer",
    default: 1000,
    description: "Number of boosting rounds",
  },
  {
    key: "max_depth",
    type: "integer",
    default: -1,
    description: "Maximum tree depth (-1 = no limit)",
  },
  {
    key: "subsample",
    type: "float",
    default: 1.0,
    description: "Row sampling ratio",
  },
  {
    key: "colsample_bytree",
    type: "float",
    default: 1.0,
    description: "Feature sampling ratio",
  },
  {
    key: "reg_alpha",
    type: "float",
    default: 0.0,
    description: "L1 regularization",
  },
  {
    key: "reg_lambda",
    type: "float",
    default: 0.0,
    description: "L2 regularization",
  },
];

/** Task-specific evaluation metrics. */
export const METRICS_BY_TASK: Record<
  string,
  { available: string[]; defaults: string[] }
> = {
  binary: {
    available: ["auc", "logloss", "accuracy", "f1", "precision", "recall"],
    defaults: ["auc", "logloss"],
  },
  multiclass: {
    available: ["accuracy", "f1_macro", "multi_logloss"],
    defaults: ["accuracy", "multi_logloss"],
  },
  regression: {
    available: ["rmse", "mae", "r2", "mse"],
    defaults: ["rmse", "mae"],
  },
};

/** Default search space ranges for Tune tab. */
export const RANGE_DEFAULTS: Record<
  string,
  { low: number; high: number; log: boolean; step?: number }
> = {
  learning_rate: { low: 0.005, high: 0.3, log: true },
  num_leaves: { low: 10, high: 200, log: false, step: 1 },
  n_estimators: { low: 100, high: 3000, log: false, step: 100 },
  max_depth: { low: 3, high: 12, log: false, step: 1 },
  subsample: { low: 0.5, high: 1.0, log: false },
  colsample_bytree: { low: 0.5, high: 1.0, log: false },
  reg_alpha: { low: 1e-8, high: 10.0, log: true },
  reg_lambda: { low: 1e-8, high: 10.0, log: true },
};

/** Default calibration config when toggled ON. */
export const CALIBRATION_DEFAULTS = {
  method: "platt",
  n_splits: 5,
  params: {},
} as const;

/** Preset choices for Tune Settings SegmentedControls. */
export const N_TRIALS_PRESETS = [50, 100, 200, 500] as const;
export const TIMEOUT_PRESETS = [
  { label: "None", value: null },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
  { label: "30m", value: 1800 },
] as const;
