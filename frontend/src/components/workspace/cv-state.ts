import type { BlockedGroupKFoldState } from "./BlockedGroupKFoldEditor";
import { INITIAL_BLOCKED_STATE } from "./BlockedGroupKFoldEditor";
import { CV_STRATEGY_FIELDS } from "./constants";

/** Default values for CV fields, reset when strategy changes. */
export const CV_FIELD_DEFAULTS = {
  folds: 5,
  random_state: 42,
  shuffle: true,
  gap: 0,
  purge_gap: 0,
  embargo: 0,
} as const;

export interface CvState {
  strategy: string;
  folds: number;
  randomState: number | undefined;
  shuffle: boolean;
  groupCol: string | null;
  timeCol: string | null;
  gap: number | undefined;
  purgeGap: number | undefined;
  embargo: number | undefined;
  trainSizeMax: number | undefined;
  testSizeMax: number | undefined;
  minTrainRows: number | undefined;
  minValidRows: number | undefined;
}

export const INITIAL_CV_STATE: CvState = {
  strategy: "stratified_kfold",
  folds: CV_FIELD_DEFAULTS.folds,
  randomState: CV_FIELD_DEFAULTS.random_state,
  shuffle: CV_FIELD_DEFAULTS.shuffle,
  groupCol: null,
  timeCol: null,
  gap: CV_FIELD_DEFAULTS.gap,
  purgeGap: CV_FIELD_DEFAULTS.purge_gap,
  embargo: CV_FIELD_DEFAULTS.embargo,
  trainSizeMax: undefined,
  testSizeMax: undefined,
  minTrainRows: undefined,
  minValidRows: undefined,
};

/** Reset all conditional CV fields to defaults (called on strategy change). */
export function resetCvState(strategy: string): CvState {
  return { ...INITIAL_CV_STATE, strategy };
}

/** Recommend the inner validation method based on outer CV strategy. */
export function recommendedInnerValid(strategy: string): string {
  switch (strategy) {
    case "group_kfold":
    case "stratified_group_kfold":
    case "blocked_group_kfold":
      return "group_holdout";
    case "time_series":
    case "purged_time_series":
    case "group_time_series":
      return "time_holdout";
    default:
      return "holdout";
  }
}

/** Build a split config object containing only strategy-relevant fields. */
export function buildSplitConfig(
  cv: CvState,
  blocked?: BlockedGroupKFoldState,
): Record<string, unknown> {
  const fields = CV_STRATEGY_FIELDS[cv.strategy] ?? ["folds"];
  const split: Record<string, unknown> = {
    method: cv.strategy,
    n_splits: cv.folds,
  };
  if (fields.includes("random_state") && cv.randomState !== undefined) {
    split.random_state = cv.randomState;
  }
  if (fields.includes("shuffle")) {
    split.shuffle = cv.shuffle;
  }
  if (fields.includes("gap") && cv.gap !== undefined) {
    split.gap = cv.gap;
  }
  if (fields.includes("purge_gap") && cv.purgeGap !== undefined) {
    split.purge_gap = cv.purgeGap;
  }
  if (fields.includes("embargo") && cv.embargo !== undefined) {
    split.embargo = cv.embargo;
  }
  if (fields.includes("train_size_max") && cv.trainSizeMax !== undefined) {
    split.train_size_max = cv.trainSizeMax;
  }
  if (fields.includes("test_size_max") && cv.testSizeMax !== undefined) {
    split.test_size_max = cv.testSizeMax;
  }
  if (fields.includes("min_train_rows") && cv.minTrainRows !== undefined) {
    split.min_train_rows = cv.minTrainRows;
  }
  if (fields.includes("min_valid_rows") && cv.minValidRows !== undefined) {
    split.min_valid_rows = cv.minValidRows;
  }
  // blocked_group_kfold-specific fields from the dedicated editor state
  if (cv.strategy === "blocked_group_kfold") {
    const b = blocked ?? INITIAL_BLOCKED_STATE;
    split.mode = b.blockMode;
    split.train_window = b.trainWindow;
    if (b.cutoffs.length > 0) {
      split.cutoffs = b.cutoffs;
    }
    if (b.stratify !== "auto") {
      split.stratify = b.stratify === "on";
    }
  }
  return split;
}

/** Extract group_col / time_col into data config when strategy requires them. */
export function applyCvDataFields(
  data: Record<string, unknown>,
  cv: CvState,
): Record<string, unknown> {
  const fields = CV_STRATEGY_FIELDS[cv.strategy] ?? [];
  const result = { ...data };
  // blocked_group_kfold uses blocks_col/groups_col instead of time_col/group_col
  if (cv.strategy === "blocked_group_kfold") {
    if (cv.timeCol) {
      result.blocks_col = cv.timeCol;
    }
    if (cv.groupCol) {
      result.groups_col = cv.groupCol;
    }
    return result;
  }
  if (fields.includes("group_col") && cv.groupCol) {
    result.group_col = cv.groupCol;
  }
  if (fields.includes("time_col") && cv.timeCol) {
    result.time_col = cv.timeCol;
  }
  return result;
}
