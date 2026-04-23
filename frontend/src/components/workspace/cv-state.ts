import type { UiSchema } from "@/api/types";
import type { BlockedGroupKFoldState } from "./BlockedGroupKFoldEditor";
import { INITIAL_BLOCKED_STATE } from "./BlockedGroupKFoldEditor";
import { getDefaultCvStrategy } from "./constants";

/**
 * B-5 / H-0077: resolve the default CV strategy for a task, preferring
 * the backend's `UiSchema.capabilities.cv_default_strategy` before
 * falling back to the UI-local `getDefaultCvStrategy` (H-0074 map).
 * Extracted so `useDataPanel` and `useTargetSelection` share one
 * resolution path instead of each reimplementing the nullish chain.
 */
export function getEffectiveCvStrategy(
  task: string,
  uiSchema: UiSchema | undefined,
): string {
  return (
    uiSchema?.capabilities?.cv_default_strategy?.[task] ??
    getDefaultCvStrategy(task)
  );
}

/**
 * C-5b Part 2 (H-0076): conditional-field allow-list per strategy. This
 * mirrors `UiSchema.capabilities.cv_strategy_fields` emitted by
 * `lizyml_ui_schema.py` and serves as the fallback when ``fields`` is
 * not explicitly passed (e.g. pre-load or tests that want the legacy
 * behaviour). Keep this in sync with the backend SSOT — the shape is
 * asserted by `tests/test_ui_schema.py::test_capabilities_cv_strategy_fields_ui_semantics`.
 */
// Issue #258 / #259: every field must match the backend Pydantic
// variant (or DataConfig for target/time_col/group_col). A contract
// test on the backend side
// (``tests/contract/test_ui_schema_matches_pydantic.py``) locks this
// invariant server-side; this fallback only applies before the live
// UI schema is fetched, so keep it in sync to avoid the same drift
// class at boot time.
export const FALLBACK_CV_STRATEGY_FIELDS: Record<string, readonly string[]> = {
  kfold: ["n_splits", "random_state", "shuffle"],
  stratified_kfold: ["n_splits", "random_state"],
  group_kfold: ["n_splits", "group_col"],
  stratified_group_kfold: ["n_splits", "random_state", "shuffle", "group_col"],
  time_series: [
    "n_splits",
    "time_col",
    "gap",
    "train_size_max",
    "test_size_max",
  ],
  purged_time_series: [
    "n_splits",
    "time_col",
    "purge_gap",
    "embargo",
    "train_size_max",
    "test_size_max",
  ],
  group_time_series: [
    "n_splits",
    "time_col",
    "group_col",
    "gap",
    "train_size_max",
    "test_size_max",
  ],
  blocked_group_kfold: [
    "time_col",
    "group_col",
    "min_train_rows",
    "min_valid_rows",
  ],
};

/**
 * Resolve the conditional-field allow-list. Explicit ``fields`` wins;
 * otherwise fall back to the strategy-indexed map above. Unknown
 * strategies fall through to ``["n_splits"]`` so Folds is always
 * included but ``group_col`` / ``time_col`` are NOT injected. If a
 * new backend introduces a new strategy name, add it to both
 * :data:`FALLBACK_CV_STRATEGY_FIELDS` and the backend-side
 * ``capabilities.cv_strategy_fields`` simultaneously (see
 * `lizyml_ui_schema.py`).
 */
function resolveFields(
  strategy: string,
  explicit: readonly string[] | undefined,
): readonly string[] {
  if (explicit !== undefined) return explicit;
  return FALLBACK_CV_STRATEGY_FIELDS[strategy] ?? ["n_splits"];
}

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

const GROUP_STRATEGIES = new Set([
  "group_kfold",
  "stratified_group_kfold",
  "group_time_series",
  "blocked_group_kfold",
]);

const TIME_STRATEGIES = new Set([
  "time_series",
  "purged_time_series",
  "group_time_series",
]);

/** Filter inner_valid options based on the outer CV strategy. */
export function filterInnerValidOptions(
  options: string[],
  strategy: string,
): string[] {
  const hasGroup = GROUP_STRATEGIES.has(strategy);
  const hasTime = TIME_STRATEGIES.has(strategy);
  return options.filter((opt) => {
    if (opt === "group_holdout") return hasGroup;
    if (opt === "time_holdout") return hasTime;
    return true; // holdout is always allowed
  });
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

/** Build a split config object containing only strategy-relevant fields.
 *
 * ``fields`` is the `UiSchema.capabilities.cv_strategy_fields[strategy]`
 * allow-list (wire-format names). When omitted (uiSchema not yet
 * loaded) this falls back to emitting every conditional field for which
 * ``cv`` has a value — the legacy pre-H-0076 behaviour.
 */
export function buildSplitConfig(
  cv: CvState,
  blocked?: BlockedGroupKFoldState,
  fields?: readonly string[],
): Record<string, unknown> {
  const active = resolveFields(cv.strategy, fields);
  const split: Record<string, unknown> = {
    method: cv.strategy,
  };
  // Issue #258 / #259: n_splits is strategy-specific. Pydantic variants
  // like BlockedGroupKFoldConfig have no n_splits field and reject it
  // with extra="forbid". Gate the assignment on the active fields list
  // (same pattern as every other split property below).
  if (active.includes("n_splits")) {
    split.n_splits = cv.folds;
  }
  if (active.includes("random_state") && cv.randomState !== undefined) {
    split.random_state = cv.randomState;
  }
  if (active.includes("shuffle")) {
    split.shuffle = cv.shuffle;
  }
  if (active.includes("gap") && cv.gap !== undefined) {
    split.gap = cv.gap;
  }
  if (active.includes("purge_gap") && cv.purgeGap !== undefined) {
    split.purge_gap = cv.purgeGap;
  }
  if (active.includes("embargo") && cv.embargo !== undefined) {
    split.embargo = cv.embargo;
  }
  if (active.includes("train_size_max") && cv.trainSizeMax !== undefined) {
    split.train_size_max = cv.trainSizeMax;
  }
  if (active.includes("test_size_max") && cv.testSizeMax !== undefined) {
    split.test_size_max = cv.testSizeMax;
  }
  if (active.includes("min_train_rows") && cv.minTrainRows !== undefined) {
    split.min_train_rows = cv.minTrainRows;
  }
  if (active.includes("min_valid_rows") && cv.minValidRows !== undefined) {
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

/** Extract group_col / time_col into data config when strategy requires them.
 *
 * ``fields`` behaves the same as in {@link buildSplitConfig}. When
 * omitted we fall back to injecting whatever ``cv`` supplies.
 */
export function applyCvDataFields(
  data: Record<string, unknown>,
  cv: CvState,
  fields?: readonly string[],
): Record<string, unknown> {
  const active = resolveFields(cv.strategy, fields);
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
  if (active.includes("group_col") && cv.groupCol) {
    result.group_col = cv.groupCol;
  }
  if (active.includes("time_col") && cv.timeCol) {
    result.time_col = cv.timeCol;
  }
  return result;
}
