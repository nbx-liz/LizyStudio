import { describe, expect, it } from "vitest";
import binaryIsotonicFit from "../__fixtures__/lizyml/fit_result_binary_isotonic.json";
import binaryNoCalFit from "../__fixtures__/lizyml/fit_result_binary_no_cal.json";
import regressionFit from "../__fixtures__/lizyml/fit_result_regression.json";
import tuneFit from "../__fixtures__/lizyml/fit_result_tune.json";
import { pivotMetrics } from "./metrics";

const BINARY_METRIC_NAMES = [
  "auc",
  "accuracy",
  "auc_pr",
  "brier",
  "ece",
  "f1",
  "logloss",
  "precision_at_k",
] as const;
const REGRESSION_METRIC_NAMES = [
  "huber",
  "mae",
  "mape",
  "r2",
  "rmse",
  "rmsle",
] as const;

describe("pivotMetrics", () => {
  it("pivots wrapped backend metrics (single top-level key)", () => {
    const raw = {
      raw: {
        if_mean: { auc: 0.95, logloss: 0.2 },
        oof: { auc: 0.88, logloss: 0.35 },
        oof_std: { auc: 0.01, logloss: 0.02 },
      },
    };
    const result = pivotMetrics(raw);
    expect(result.auc).toEqual({ is: 0.95, oos: 0.88, oos_std: 0.01 });
    expect(result.logloss).toEqual({ is: 0.2, oos: 0.35, oos_std: 0.02 });
  });

  it("handles flat structure without wrapping key", () => {
    const raw = {
      if_mean: { rmse: 1.5 },
      oof: { rmse: 2.0 },
      oof_std: { rmse: 0.3 },
    };
    const result = pivotMetrics(raw);
    expect(result.rmse).toEqual({ is: 1.5, oos: 2.0, oos_std: 0.3 });
  });

  it("returns NaN for missing metric slots", () => {
    const raw = {
      raw: {
        if_mean: { auc: 0.9 },
        oof: {},
      },
    };
    const result = pivotMetrics(raw);
    expect(result.auc.is).toBe(0.9);
    expect(result.auc.oos).toBeNaN();
    expect(result.auc.oos_std).toBeNaN();
  });

  it("handles alternative key names (is/oos/oos_std)", () => {
    const raw = {
      is: { f1: 0.8 },
      oos: { f1: 0.7 },
      oos_std: { f1: 0.05 },
    };
    const result = pivotMetrics(raw);
    expect(result.f1).toEqual({ is: 0.8, oos: 0.7, oos_std: 0.05 });
  });

  it("handles empty metrics", () => {
    const raw = { raw: {} };
    const result = pivotMetrics(raw);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("does not unwrap when multiple top-level keys exist (no 'raw' subkey)", () => {
    const raw = {
      if_mean: { acc: 0.9 },
      oof: { acc: 0.8 },
    };
    const result = pivotMetrics(raw);
    expect(result.acc).toEqual({ is: 0.9, oos: 0.8, oos_std: Number.NaN });
  });

  // Regression: when calibration is enabled the backend returns
  // ``{raw: {...}, calibrated: {...}}`` (TWO top-level keys), and the
  // earlier ``keys.length === 1`` guard refused to unwrap — every
  // metric came back as NaN and the Score / Metric panel rendered
  // empty. The frontend prefers the ``raw`` sub-tree when present.
  it("unwraps the 'raw' subtree when calibrated is also present", () => {
    const raw = {
      raw: {
        if_mean: { auc: 0.95, logloss: 0.2 },
        oof: { auc: 0.88, logloss: 0.35 },
        oof_std: { auc: 0.01, logloss: 0.02 },
      },
      calibrated: {
        if_mean: { auc: 0.97 },
        oof: { auc: 0.9 },
      },
    };
    const result = pivotMetrics(raw);
    expect(result.auc).toEqual({ is: 0.95, oos: 0.88, oos_std: 0.01 });
    expect(result.logloss).toEqual({ is: 0.2, oos: 0.35, oos_std: 0.02 });
  });
});

// Production-artifact regression coverage (Issue #346 Phase B). Each test
// pivots a fit_result.json captured from a real GUI run so future shape
// drift in lizyml or LizyStudio's API/Service layer trips the assertion
// before reaching users.
describe("pivotMetrics with real fit_result fixtures", () => {
  it("pivots a real binary fit (no calibration) — 8 metrics, finite values", () => {
    const result = pivotMetrics(binaryNoCalFit.metrics);
    for (const name of BINARY_METRIC_NAMES) {
      expect(result[name], `metric ${name} missing`).toBeDefined();
      expect(Number.isFinite(result[name].is)).toBe(true);
      expect(Number.isFinite(result[name].oos)).toBe(true);
    }
    // is/oos values must come from the only top-level "raw" subtree.
    expect(result.auc.is).toBe(binaryNoCalFit.metrics.raw.if_mean.auc);
    expect(result.auc.oos).toBe(binaryNoCalFit.metrics.raw.oof.auc);
  });

  // Locks PR #344 regression: when calibration is enabled the backend
  // emits ``metrics: {raw: {...}, calibrated: {...}}`` and pivotMetrics
  // must unwrap the canonical ``raw`` subtree. Previously the
  // ``keys.length === 1`` guard refused to unwrap, leaving every metric
  // NaN and the Score / Metric panel empty.
  it("unwraps the canonical 'raw' subtree on a real calibrated fit", () => {
    const result = pivotMetrics(binaryIsotonicFit.metrics);
    for (const name of BINARY_METRIC_NAMES) {
      expect(result[name], `metric ${name} missing`).toBeDefined();
      expect(Number.isFinite(result[name].is)).toBe(true);
      expect(Number.isFinite(result[name].oos)).toBe(true);
    }
    // Anti-confusion: is/oos must come from raw, NOT calibrated. The
    // fixture's calibrated.oof.auc differs from raw.oof.auc, so a
    // pivot that picked up calibrated would fail this assertion.
    const rawAuc = binaryIsotonicFit.metrics.raw.if_mean.auc;
    const rawOofAuc = binaryIsotonicFit.metrics.raw.oof.auc;
    const calOofAuc = binaryIsotonicFit.metrics.calibrated.oof.auc;
    expect(rawOofAuc).not.toBe(calOofAuc);
    expect(result.auc.is).toBe(rawAuc);
    expect(result.auc.oos).toBe(rawOofAuc);
  });

  it("pivots a real regression fit — 6 metrics, finite values", () => {
    const result = pivotMetrics(regressionFit.metrics);
    for (const name of REGRESSION_METRIC_NAMES) {
      expect(result[name], `metric ${name} missing`).toBeDefined();
      expect(Number.isFinite(result[name].is)).toBe(true);
      expect(Number.isFinite(result[name].oos)).toBe(true);
    }
    expect(result.rmse.is).toBe(regressionFit.metrics.raw.if_mean.rmse);
    expect(result.r2.oos).toBe(regressionFit.metrics.raw.oof.r2);
  });

  it("pivots a real tune fit — same 8 binary metrics on tuned best params", () => {
    const result = pivotMetrics(tuneFit.metrics);
    for (const name of BINARY_METRIC_NAMES) {
      expect(result[name], `metric ${name} missing`).toBeDefined();
      expect(Number.isFinite(result[name].is)).toBe(true);
      expect(Number.isFinite(result[name].oos)).toBe(true);
    }
  });
});
