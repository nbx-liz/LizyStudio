/**
 * Tests for workspace constants — ensures fallback values are consistent
 * with backend ui_schema expectations.
 */
import { describe, expect, it } from "vitest";
import {
  CALIBRATION_DEFAULTS,
  CV_STRATEGY_FIELDS,
  CV_STRATEGY_LABELS,
  getDefaultCvStrategy,
  KNOWN_PARAMS,
  METRICS_BY_TASK,
  N_TRIALS_PRESETS,
  RANGE_DEFAULTS,
  TIMEOUT_PRESETS,
} from "./constants";

describe("N_TRIALS_PRESETS", () => {
  it("matches backend ui_schema presets [10, 50, 100, 200, 500]", () => {
    expect([...N_TRIALS_PRESETS]).toEqual([10, 50, 100, 200, 500]);
  });

  it("is sorted ascending", () => {
    const arr = [...N_TRIALS_PRESETS];
    for (let i = 1; i < arr.length; i++) {
      expect(arr[i]).toBeGreaterThan(arr[i - 1]);
    }
  });
});

describe("TIMEOUT_PRESETS", () => {
  it("starts with None (null)", () => {
    expect(TIMEOUT_PRESETS[0]).toEqual({ label: "None", value: null });
  });

  it("has numeric values for non-None presets", () => {
    for (const p of TIMEOUT_PRESETS.slice(1)) {
      expect(typeof p.value).toBe("number");
      expect(p.value).toBeGreaterThan(0);
    }
  });
});

describe("KNOWN_PARAMS", () => {
  it("contains learning_rate and n_estimators", () => {
    const keys = KNOWN_PARAMS.map((p) => p.key);
    expect(keys).toContain("learning_rate");
    expect(keys).toContain("n_estimators");
  });

  it("each param has key, type, default, description", () => {
    for (const p of KNOWN_PARAMS) {
      expect(p.key).toBeTruthy();
      expect(["float", "integer"]).toContain(p.type);
      expect(typeof p.default).toBe("number");
      expect(p.description).toBeTruthy();
    }
  });
});

describe("METRICS_BY_TASK", () => {
  it("has entries for binary, multiclass, regression", () => {
    expect(METRICS_BY_TASK).toHaveProperty("binary");
    expect(METRICS_BY_TASK).toHaveProperty("multiclass");
    expect(METRICS_BY_TASK).toHaveProperty("regression");
  });

  it("each task has available array with at least one metric", () => {
    for (const [, info] of Object.entries(METRICS_BY_TASK)) {
      expect(info.available.length).toBeGreaterThan(0);
    }
  });

  it("uses lowercase metric names", () => {
    for (const [, info] of Object.entries(METRICS_BY_TASK)) {
      for (const m of info.available) {
        expect(m).toBe(m.toLowerCase());
      }
    }
  });
});

describe("RANGE_DEFAULTS", () => {
  it("has learning_rate with log=true", () => {
    expect(RANGE_DEFAULTS.learning_rate.log).toBe(true);
  });

  it("all entries have low < high", () => {
    for (const [, range] of Object.entries(RANGE_DEFAULTS)) {
      expect(range.low).toBeLessThan(range.high);
    }
  });
});

describe("CALIBRATION_DEFAULTS", () => {
  it("has method platt and n_splits 5", () => {
    expect(CALIBRATION_DEFAULTS.method).toBe("platt");
    expect(CALIBRATION_DEFAULTS.n_splits).toBe(5);
  });
});

describe("CV_STRATEGY_LABELS", () => {
  it("has all 8 strategies", () => {
    const expectedKeys = [
      "kfold",
      "stratified_kfold",
      "group_kfold",
      "stratified_group_kfold",
      "time_series",
      "purged_time_series",
      "group_time_series",
      "blocked_group_kfold",
    ];
    expect(Object.keys(CV_STRATEGY_LABELS)).toHaveLength(8);
    for (const key of expectedKeys) {
      expect(CV_STRATEGY_LABELS).toHaveProperty(key);
      expect(typeof CV_STRATEGY_LABELS[key]).toBe("string");
      expect(CV_STRATEGY_LABELS[key].length).toBeGreaterThan(0);
    }
  });
});

describe("CV_STRATEGY_FIELDS", () => {
  it("maps conditional fields per strategy", () => {
    expect(CV_STRATEGY_FIELDS.kfold).toEqual([
      "folds",
      "random_state",
      "shuffle",
    ]);
    expect(CV_STRATEGY_FIELDS.stratified_kfold).toEqual([
      "folds",
      "random_state",
    ]);
    expect(CV_STRATEGY_FIELDS.group_kfold).toEqual(["folds", "group_col"]);
    expect(CV_STRATEGY_FIELDS.stratified_group_kfold).toEqual([
      "folds",
      "random_state",
      "group_col",
    ]);
    expect(CV_STRATEGY_FIELDS.time_series).toEqual([
      "folds",
      "time_col",
      "gap",
      "train_size_max",
      "test_size_max",
    ]);
    expect(CV_STRATEGY_FIELDS.purged_time_series).toEqual([
      "folds",
      "time_col",
      "purge_gap",
      "embargo",
      "train_size_max",
      "test_size_max",
    ]);
    expect(CV_STRATEGY_FIELDS.group_time_series).toEqual([
      "folds",
      "time_col",
      "group_col",
      "gap",
      "train_size_max",
      "test_size_max",
    ]);
    expect(CV_STRATEGY_FIELDS.blocked_group_kfold).toEqual([
      "folds",
      "time_col",
      "group_col",
      "min_train_rows",
      "min_valid_rows",
    ]);
  });
});

describe("getDefaultCvStrategy", () => {
  it("returns correct defaults per task", () => {
    expect(getDefaultCvStrategy("binary")).toBe("stratified_kfold");
    expect(getDefaultCvStrategy("multiclass")).toBe("stratified_kfold");
    expect(getDefaultCvStrategy("regression")).toBe("kfold");
  });
});
