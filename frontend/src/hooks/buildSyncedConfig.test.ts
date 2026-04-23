import { describe, expect, it } from "vitest";
import { INITIAL_BLOCKED_STATE } from "@/components/workspace/BlockedGroupKFoldEditor";
import { INITIAL_CV_STATE } from "@/components/workspace/cv-state";
import { buildSyncedConfig } from "./buildSyncedConfig";

const BASE = {
  config_version: 1,
  task: "binary",
  data: { path: null, target: null, time_col: null, group_col: null },
  features: { exclude: [], categorical: [], auto_categorical: true },
  split: { method: "stratified_kfold", n_splits: 5 },
  model: { name: "lgbm", params: {} },
  training: {
    seed: 42,
    early_stopping: { enabled: true, rounds: 150 },
    inner_valid: { method: "holdout", ratio: 0.1 },
  },
  evaluation: { metrics: [] },
  calibration: null,
  tuning: null,
};

describe("buildSyncedConfig", () => {
  it("applies target, task, dataPath into data section", () => {
    const out = buildSyncedConfig({
      base: BASE,
      dataPath: "/tmp/data.csv",
      target: "Survived",
      task: "binary",
      overrides: {},
      cv: INITIAL_CV_STATE,
      blocked: INITIAL_BLOCKED_STATE,
    });
    expect((out.data as Record<string, unknown>).target).toBe("Survived");
    expect((out.data as Record<string, unknown>).path).toBe("/tmp/data.csv");
    expect(out.task).toBe("binary");
  });

  it("extracts exclude and categorical from overrides", () => {
    const out = buildSyncedConfig({
      base: BASE,
      dataPath: "",
      target: "target",
      task: "binary",
      overrides: {
        age: { excluded: true, type: "numeric" },
        gender: { excluded: false, type: "categorical" },
      },
      cv: INITIAL_CV_STATE,
      blocked: INITIAL_BLOCKED_STATE,
    });
    const features = out.features as Record<string, unknown>;
    expect(features.exclude).toEqual(["age"]);
    expect(features.categorical).toEqual(["gender"]);
  });

  it("falls back to base task when task arg is null", () => {
    const out = buildSyncedConfig({
      base: { ...BASE, task: "regression" },
      dataPath: "",
      target: "y",
      task: null,
      overrides: {},
      cv: INITIAL_CV_STATE,
      blocked: INITIAL_BLOCKED_STATE,
    });
    expect(out.task).toBe("regression");
  });

  it("does not mutate the base config", () => {
    const base = structuredClone(BASE);
    buildSyncedConfig({
      base,
      dataPath: "/d",
      target: "y",
      task: "binary",
      overrides: { x: { excluded: true, type: "numeric" } },
      cv: INITIAL_CV_STATE,
      blocked: INITIAL_BLOCKED_STATE,
    });
    expect(base).toEqual(BASE);
  });

  it("emits a split section based on cv state", () => {
    const out = buildSyncedConfig({
      base: BASE,
      dataPath: "",
      target: "y",
      task: "binary",
      overrides: {},
      cv: { ...INITIAL_CV_STATE, strategy: "kfold", folds: 7 },
      blocked: INITIAL_BLOCKED_STATE,
    });
    const split = out.split as Record<string, unknown>;
    expect(split.method).toBe("kfold");
    expect(split.n_splits).toBe(7);
  });
});
