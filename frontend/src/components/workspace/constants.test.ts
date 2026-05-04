/**
 * Tests for workspace constants — ensures fallback values are consistent
 * with backend ui_schema expectations.
 */
import { describe, expect, it } from "vitest";
import {
  CALIBRATION_DEFAULTS,
  CV_STRATEGY_LABELS,
  getDefaultCvStrategy,
  N_TRIALS_PRESETS,
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

describe("CALIBRATION_DEFAULTS", () => {
  it("has method isotonic and n_splits 5", () => {
    expect(CALIBRATION_DEFAULTS.method).toBe("isotonic");
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

describe("getDefaultCvStrategy", () => {
  it("returns correct defaults per task", () => {
    expect(getDefaultCvStrategy("binary")).toBe("stratified_kfold");
    expect(getDefaultCvStrategy("multiclass")).toBe("stratified_kfold");
    expect(getDefaultCvStrategy("regression")).toBe("kfold");
  });
});
