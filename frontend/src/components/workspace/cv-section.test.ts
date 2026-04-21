/**
 * Tests for CvSection pure functions: resetCvState, buildSplitConfig, applyCvDataFields.
 */
import { describe, expect, it } from "vitest";
import {
  applyCvDataFields,
  type BlockedGroupKFoldState,
  buildSplitConfig,
  type CvState,
  INITIAL_BLOCKED_STATE,
  INITIAL_CV_STATE,
  recommendedInnerValid,
  resetCvState,
} from "./CvSection";

// C-5b Part 2 (H-0076): `cv_strategy_fields` comes from the backend
// UiSchema at runtime. The map below mirrors what
// `lizyml_ui_schema.py` emits and is used to drive every test that
// previously imported `CV_STRATEGY_FIELDS` from `./constants`.
const CV_STRATEGY_FIELDS: Record<string, readonly string[]> = {
  kfold: ["n_splits", "random_state", "shuffle"],
  stratified_kfold: ["n_splits", "random_state", "shuffle"],
  group_kfold: ["n_splits", "group_col"],
  stratified_group_kfold: ["n_splits", "random_state", "group_col"],
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
    "n_splits",
    "time_col",
    "group_col",
    "min_train_rows",
    "min_valid_rows",
  ],
};

// ---------------------------------------------------------------------------
// resetCvState
// ---------------------------------------------------------------------------
describe("resetCvState", () => {
  it("returns INITIAL_CV_STATE with overridden strategy", () => {
    const result = resetCvState("group_kfold");
    expect(result.strategy).toBe("group_kfold");
    expect(result.folds).toBe(INITIAL_CV_STATE.folds);
    expect(result.randomState).toBe(INITIAL_CV_STATE.randomState);
    expect(result.shuffle).toBe(INITIAL_CV_STATE.shuffle);
    expect(result.groupCol).toBeNull();
    expect(result.timeCol).toBeNull();
    expect(result.gap).toBe(INITIAL_CV_STATE.gap);
    expect(result.purgeGap).toBe(INITIAL_CV_STATE.purgeGap);
    expect(result.embargo).toBe(INITIAL_CV_STATE.embargo);
    expect(result.trainSizeMax).toBeUndefined();
    expect(result.testSizeMax).toBeUndefined();
    expect(result.minTrainRows).toBeUndefined();
    expect(result.minValidRows).toBeUndefined();
  });

  it("does not mutate INITIAL_CV_STATE", () => {
    const before = { ...INITIAL_CV_STATE };
    resetCvState("time_series");
    expect(INITIAL_CV_STATE).toEqual(before);
  });

  it("works for every known strategy", () => {
    for (const strategy of Object.keys(CV_STRATEGY_FIELDS)) {
      const state = resetCvState(strategy);
      expect(state.strategy).toBe(strategy);
      expect(state.folds).toBe(5);
    }
  });

  it("handles unknown strategy gracefully", () => {
    const state = resetCvState("unknown_strategy");
    expect(state.strategy).toBe("unknown_strategy");
    expect(state.folds).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// recommendedInnerValid
// ---------------------------------------------------------------------------
describe("recommendedInnerValid", () => {
  it("returns group_holdout for group_kfold", () => {
    expect(recommendedInnerValid("group_kfold")).toBe("group_holdout");
  });

  it("returns group_holdout for stratified_group_kfold", () => {
    expect(recommendedInnerValid("stratified_group_kfold")).toBe(
      "group_holdout",
    );
  });

  it("returns group_holdout for blocked_group_kfold", () => {
    expect(recommendedInnerValid("blocked_group_kfold")).toBe("group_holdout");
  });

  it("returns time_holdout for time_series", () => {
    expect(recommendedInnerValid("time_series")).toBe("time_holdout");
  });

  it("returns time_holdout for purged_time_series", () => {
    expect(recommendedInnerValid("purged_time_series")).toBe("time_holdout");
  });

  it("returns time_holdout for group_time_series", () => {
    expect(recommendedInnerValid("group_time_series")).toBe("time_holdout");
  });

  it("returns holdout for kfold (default case)", () => {
    expect(recommendedInnerValid("kfold")).toBe("holdout");
  });

  it("returns holdout for stratified_kfold (default case)", () => {
    expect(recommendedInnerValid("stratified_kfold")).toBe("holdout");
  });

  it("returns holdout for unknown strategy (default case)", () => {
    expect(recommendedInnerValid("unknown_strategy")).toBe("holdout");
  });
});

// ---------------------------------------------------------------------------
// buildSplitConfig
// ---------------------------------------------------------------------------
describe("buildSplitConfig", () => {
  it("always includes method and n_splits", () => {
    const cv: CvState = { ...INITIAL_CV_STATE, strategy: "kfold", folds: 10 };
    const result = buildSplitConfig(cv);
    expect(result.method).toBe("kfold");
    expect(result.n_splits).toBe(10);
  });

  describe("kfold family", () => {
    it("kfold includes folds, random_state, shuffle", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "kfold",
        folds: 5,
        randomState: 42,
        shuffle: true,
      };
      const result = buildSplitConfig(cv);
      expect(result).toEqual({
        method: "kfold",
        n_splits: 5,
        random_state: 42,
        shuffle: true,
      });
    });

    it("stratified_kfold includes folds, random_state and shuffle when fields allow all three", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "stratified_kfold",
        folds: 3,
        randomState: 0,
        shuffle: true,
      };
      const result = buildSplitConfig(
        cv,
        undefined,
        CV_STRATEGY_FIELDS.stratified_kfold,
      );
      expect(result).toEqual({
        method: "stratified_kfold",
        n_splits: 3,
        random_state: 0,
        shuffle: true,
      });
    });

    it("drops shuffle when fields map excludes it (SSOT-driven)", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "stratified_kfold",
        folds: 3,
        randomState: 0,
        shuffle: true,
      };
      // A hypothetical backend that chooses to hide shuffle for this
      // strategy — buildSplitConfig must honour the fields contract.
      const fields = ["n_splits", "random_state"];
      const result = buildSplitConfig(cv, undefined, fields);
      expect(result).not.toHaveProperty("shuffle");
    });
  });

  describe("group family", () => {
    it("group_kfold includes only folds (no group_col — that goes to data)", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "group_kfold",
        folds: 4,
        groupCol: "user_id",
      };
      const result = buildSplitConfig(cv);
      expect(result).toEqual({
        method: "group_kfold",
        n_splits: 4,
      });
      // group_col is handled by applyCvDataFields, not buildSplitConfig
      expect(result).not.toHaveProperty("group_col");
    });

    it("stratified_group_kfold includes folds and random_state", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "stratified_group_kfold",
        folds: 5,
        randomState: 123,
        groupCol: "org",
      };
      const result = buildSplitConfig(cv);
      expect(result.method).toBe("stratified_group_kfold");
      expect(result.random_state).toBe(123);
      expect(result).not.toHaveProperty("group_col");
    });
  });

  describe("time series family", () => {
    it("time_series includes gap, train_size_max, test_size_max", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "time_series",
        folds: 5,
        timeCol: "date",
        gap: 2,
        trainSizeMax: 1000,
        testSizeMax: 200,
      };
      const result = buildSplitConfig(cv);
      expect(result).toEqual({
        method: "time_series",
        n_splits: 5,
        gap: 2,
        train_size_max: 1000,
        test_size_max: 200,
      });
      expect(result).not.toHaveProperty("time_col");
    });

    it("purged_time_series includes purge_gap, embargo", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "purged_time_series",
        folds: 3,
        timeCol: "ts",
        purgeGap: 5,
        embargo: 10,
        trainSizeMax: 500,
        testSizeMax: 100,
      };
      const result = buildSplitConfig(cv);
      expect(result.method).toBe("purged_time_series");
      expect(result.purge_gap).toBe(5);
      expect(result.embargo).toBe(10);
      expect(result.train_size_max).toBe(500);
      expect(result.test_size_max).toBe(100);
      expect(result).not.toHaveProperty("gap");
    });

    it("group_time_series includes gap, train/test size_max", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "group_time_series",
        folds: 4,
        timeCol: "date",
        groupCol: "region",
        gap: 1,
        trainSizeMax: 800,
        testSizeMax: undefined,
      };
      const result = buildSplitConfig(cv);
      expect(result.method).toBe("group_time_series");
      expect(result.gap).toBe(1);
      expect(result.train_size_max).toBe(800);
      expect(result).not.toHaveProperty("test_size_max");
    });
  });

  describe("blocked_group_kfold", () => {
    it("includes min_train_rows and min_valid_rows", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "blocked_group_kfold",
        folds: 5,
        timeCol: "date",
        groupCol: "block",
        minTrainRows: 100,
        minValidRows: 50,
      };
      const result = buildSplitConfig(cv);
      expect(result.min_train_rows).toBe(100);
      expect(result.min_valid_rows).toBe(50);
    });

    it("omits undefined optional cv fields but includes blocked defaults", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "blocked_group_kfold",
        folds: 3,
        minTrainRows: undefined,
        minValidRows: undefined,
      };
      const result = buildSplitConfig(cv);
      expect(result).toEqual({
        method: "blocked_group_kfold",
        n_splits: 3,
        mode: "expanding",
        train_window: 1,
      });
    });

    it("includes blocked state fields (mode, train_window, cutoffs, stratify)", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "blocked_group_kfold",
        folds: 5,
        minTrainRows: 100,
      };
      const blocked: BlockedGroupKFoldState = {
        cutoffs: ["2023-01", "2023-06"],
        blockMode: "sliding",
        trainWindow: 3,
        stratify: "on",
      };
      const result = buildSplitConfig(cv, blocked);
      expect(result.mode).toBe("sliding");
      expect(result.train_window).toBe(3);
      expect(result.cutoffs).toEqual(["2023-01", "2023-06"]);
      expect(result.stratify).toBe(true);
      expect(result.min_train_rows).toBe(100);
    });

    it("omits cutoffs when empty", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "blocked_group_kfold",
        folds: 4,
      };
      const blocked: BlockedGroupKFoldState = {
        ...INITIAL_BLOCKED_STATE,
        cutoffs: [],
      };
      const result = buildSplitConfig(cv, blocked);
      expect(result).not.toHaveProperty("cutoffs");
      expect(result.mode).toBe("expanding");
    });

    it("omits stratify when set to auto", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "blocked_group_kfold",
        folds: 4,
      };
      const blocked: BlockedGroupKFoldState = {
        ...INITIAL_BLOCKED_STATE,
        stratify: "auto",
      };
      const result = buildSplitConfig(cv, blocked);
      expect(result).not.toHaveProperty("stratify");
    });

    it("sets stratify=false when off", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "blocked_group_kfold",
        folds: 4,
      };
      const blocked: BlockedGroupKFoldState = {
        ...INITIAL_BLOCKED_STATE,
        stratify: "off",
      };
      const result = buildSplitConfig(cv, blocked);
      expect(result.stratify).toBe(false);
    });

    it("falls back to INITIAL_BLOCKED_STATE when blocked is undefined", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "blocked_group_kfold",
        folds: 5,
      };
      const result = buildSplitConfig(cv);
      expect(result.mode).toBe("expanding");
      expect(result.train_window).toBe(1);
      expect(result).not.toHaveProperty("cutoffs");
      expect(result).not.toHaveProperty("stratify");
    });

    it("ignores blocked state for non-blocked strategies", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "kfold",
        folds: 5,
        randomState: 42,
        shuffle: true,
      };
      const blocked: BlockedGroupKFoldState = {
        cutoffs: ["2023-01"],
        blockMode: "sliding",
        trainWindow: 3,
        stratify: "on",
      };
      const result = buildSplitConfig(cv, blocked);
      expect(result).not.toHaveProperty("mode");
      expect(result).not.toHaveProperty("train_window");
      expect(result).not.toHaveProperty("cutoffs");
    });
  });

  describe("unknown strategy", () => {
    it("falls back to folds-only output", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "custom_splitter",
        folds: 7,
      };
      const result = buildSplitConfig(cv);
      expect(result).toEqual({
        method: "custom_splitter",
        n_splits: 7,
      });
    });
  });

  it("omits random_state when undefined", () => {
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "kfold",
      randomState: undefined,
    };
    const result = buildSplitConfig(cv);
    expect(result).not.toHaveProperty("random_state");
  });

  describe("fields parameter (H-0076 SSOT)", () => {
    it("without fields falls back to full conditional-field set", () => {
      // Before H-0076 buildSplitConfig had no fields param. The
      // fallback path must keep emitting every conditional field that
      // the CvState supplies — used while ``uiSchema`` has not loaded
      // yet or for integration paths that bypass the store.
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "kfold",
        folds: 5,
        randomState: 42,
        shuffle: true,
      };
      const result = buildSplitConfig(cv);
      expect(result).toMatchObject({
        method: "kfold",
        n_splits: 5,
        random_state: 42,
        shuffle: true,
      });
    });

    it("with fields honours SSOT allow-list", () => {
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "time_series",
        folds: 4,
        timeCol: "date",
        gap: 2,
        trainSizeMax: 500,
        testSizeMax: 100,
      };
      const fields = CV_STRATEGY_FIELDS.time_series;
      const result = buildSplitConfig(cv, undefined, fields);
      expect(result).toEqual({
        method: "time_series",
        n_splits: 4,
        gap: 2,
        train_size_max: 500,
        test_size_max: 100,
      });
    });

    it("skips fields that SSOT does not list even if CvState provides values", () => {
      // SSOT says only n_splits; embargo value is discarded.
      const cv: CvState = {
        ...INITIAL_CV_STATE,
        strategy: "purged_time_series",
        folds: 3,
        embargo: 99,
      };
      const result = buildSplitConfig(cv, undefined, ["n_splits"]);
      expect(result).toEqual({
        method: "purged_time_series",
        n_splits: 3,
      });
      expect(result).not.toHaveProperty("embargo");
    });
  });
});

// ---------------------------------------------------------------------------
// applyCvDataFields
// ---------------------------------------------------------------------------
describe("applyCvDataFields", () => {
  it("injects group_col for group_kfold", () => {
    const data = { path: "/data.csv", target: "y" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "group_kfold",
      groupCol: "user_id",
    };
    const result = applyCvDataFields(data, cv);
    expect(result.group_col).toBe("user_id");
    expect(result.path).toBe("/data.csv");
  });

  it("injects time_col for time_series", () => {
    const data = { path: "/data.csv" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "time_series",
      timeCol: "date",
    };
    const result = applyCvDataFields(data, cv);
    expect(result.time_col).toBe("date");
    expect(result).not.toHaveProperty("group_col");
  });

  it("injects both group_col and time_col for group_time_series", () => {
    const data = {};
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "group_time_series",
      groupCol: "region",
      timeCol: "date",
    };
    const result = applyCvDataFields(data, cv);
    expect(result.group_col).toBe("region");
    expect(result.time_col).toBe("date");
  });

  it("does not inject group_col when null", () => {
    const data = { path: "/data.csv" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "group_kfold",
      groupCol: null,
    };
    const result = applyCvDataFields(data, cv);
    expect(result).not.toHaveProperty("group_col");
  });

  it("does not inject time_col when null", () => {
    const data = {};
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "time_series",
      timeCol: null,
    };
    const result = applyCvDataFields(data, cv);
    expect(result).not.toHaveProperty("time_col");
  });

  it("does not inject fields for strategies that do not use them", () => {
    const data = { path: "/data.csv" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "stratified_kfold",
      groupCol: "should_be_ignored",
      timeCol: "also_ignored",
    };
    const result = applyCvDataFields(data, cv);
    expect(result).not.toHaveProperty("group_col");
    expect(result).not.toHaveProperty("time_col");
  });

  it("does not mutate the original data object", () => {
    const data = { path: "/data.csv" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "group_kfold",
      groupCol: "user_id",
    };
    const result = applyCvDataFields(data, cv);
    expect(data).not.toHaveProperty("group_col");
    expect(result.group_col).toBe("user_id");
  });

  it("handles unknown strategy without injecting fields (fallback map)", () => {
    // Fallback mode (fields undefined) + unknown strategy → resolveFields
    // returns ["n_splits"] so neither group_col nor time_col is
    // injected. This matches the legacy behaviour for safety.
    const data = { path: "/data.csv" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "unknown",
      groupCol: "g",
      timeCol: "t",
    };
    const result = applyCvDataFields(data, cv);
    expect(result).not.toHaveProperty("group_col");
    expect(result).not.toHaveProperty("time_col");
  });

  it("with fields honours SSOT allow-list for data injection", () => {
    const data = { path: "/data.csv" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "time_series",
      timeCol: "date",
      groupCol: "should_be_ignored",
    };
    const result = applyCvDataFields(data, cv, CV_STRATEGY_FIELDS.time_series);
    expect(result.time_col).toBe("date");
    expect(result).not.toHaveProperty("group_col");
  });

  it("injects blocks_col and groups_col for blocked_group_kfold (not time_col/group_col)", () => {
    const data = { path: "/data.csv", target: "y" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "blocked_group_kfold",
      timeCol: "period",
      groupCol: "entity",
    };
    const result = applyCvDataFields(data, cv);
    expect(result.blocks_col).toBe("period");
    expect(result.groups_col).toBe("entity");
    expect(result).not.toHaveProperty("time_col");
    expect(result).not.toHaveProperty("group_col");
  });

  it("does not inject blocks_col/groups_col when null", () => {
    const data = { path: "/data.csv" };
    const cv: CvState = {
      ...INITIAL_CV_STATE,
      strategy: "blocked_group_kfold",
      timeCol: null,
      groupCol: null,
    };
    const result = applyCvDataFields(data, cv);
    expect(result).not.toHaveProperty("blocks_col");
    expect(result).not.toHaveProperty("groups_col");
  });
});
