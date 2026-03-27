import { describe, expect, it } from "vitest";
import { pivotMetrics } from "./metrics";

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

  it("does not unwrap when multiple top-level keys exist", () => {
    const raw = {
      if_mean: { acc: 0.9 },
      oof: { acc: 0.8 },
    };
    const result = pivotMetrics(raw);
    expect(result.acc).toEqual({ is: 0.9, oos: 0.8, oos_std: Number.NaN });
  });
});
