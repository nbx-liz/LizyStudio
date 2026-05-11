import { describe, expect, it } from "vitest";
import type { UiSchema } from "@/api/types";
import {
  evalMetricMap,
  evalMetricOptionsFor,
  isCustomFevalMetric,
  metricChoicesFor,
  metricOptionsFor,
  objectiveOptionsFor,
} from "./metric-options";

const uiSchema = {
  option_sets: {
    objective: {
      binary: ["binary", "cross_entropy"],
      regression: ["huber", "regression_l1"],
    },
    metric: {
      binary: {
        native: ["auc", "binary_logloss"],
        feval: ["f1", "brier"],
      },
      regression: {
        native: ["rmse", "mae"],
        feval: ["r2"],
      },
    },
    eval_metric: {
      binary: ["auc", "auc_pr", "logloss"],
      regression: ["rmse", "r2"],
    },
  },
} as unknown as UiSchema;

describe("metric-options helpers", () => {
  it("objectiveOptionsFor returns the task's objective list", () => {
    expect(objectiveOptionsFor(uiSchema, "binary")).toEqual([
      "binary",
      "cross_entropy",
    ]);
    expect(objectiveOptionsFor(uiSchema, null)).toEqual([]);
    expect(objectiveOptionsFor(uiSchema, "unknown_task")).toEqual([]);
    expect(objectiveOptionsFor(undefined, "binary")).toEqual([]);
  });

  it("metricChoicesFor returns the native/feval split", () => {
    expect(metricChoicesFor(uiSchema, "binary")).toEqual({
      native: ["auc", "binary_logloss"],
      feval: ["f1", "brier"],
    });
    expect(metricChoicesFor(uiSchema, null)).toEqual({
      native: [],
      feval: [],
    });
    expect(metricChoicesFor(uiSchema, "missing")).toEqual({
      native: [],
      feval: [],
    });
  });

  it("metricOptionsFor flattens native then feval", () => {
    expect(metricOptionsFor(uiSchema, "binary")).toEqual([
      "auc",
      "binary_logloss",
      "f1",
      "brier",
    ]);
    expect(metricOptionsFor(uiSchema, "regression")).toEqual([
      "rmse",
      "mae",
      "r2",
    ]);
  });

  it("evalMetricOptionsFor returns the eval-registry list", () => {
    expect(evalMetricOptionsFor(uiSchema, "binary")).toEqual([
      "auc",
      "auc_pr",
      "logloss",
    ]);
    expect(evalMetricOptionsFor(uiSchema, null)).toEqual([]);
  });

  it("evalMetricMap returns the {task: [...]} map", () => {
    expect(evalMetricMap(uiSchema)).toEqual({
      binary: ["auc", "auc_pr", "logloss"],
      regression: ["rmse", "r2"],
    });
    expect(evalMetricMap(undefined)).toEqual({});
  });

  it("isCustomFevalMetric flags feval-only metrics", () => {
    expect(isCustomFevalMetric(uiSchema, "binary", "f1")).toBe(true);
    expect(isCustomFevalMetric(uiSchema, "binary", "brier")).toBe(true);
    expect(isCustomFevalMetric(uiSchema, "binary", "auc")).toBe(false);
    expect(isCustomFevalMetric(uiSchema, "binary", "not_a_metric")).toBe(false);
    expect(isCustomFevalMetric(uiSchema, null, "f1")).toBe(false);
  });
});
