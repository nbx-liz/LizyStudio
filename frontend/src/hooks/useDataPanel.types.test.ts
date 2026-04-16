import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "@/api/types";
import {
  buildMergedConfig,
  buildOverridesFromColumns,
  buildSyncKey,
  extractOverrideArrays,
  TASK_OPTIONS,
} from "./useDataPanel.types";

describe("TASK_OPTIONS", () => {
  it("contains binary, multiclass, regression", () => {
    expect(TASK_OPTIONS).toEqual(["binary", "multiclass", "regression"]);
  });
});

describe("buildOverridesFromColumns", () => {
  it("maps columns to ColumnOverride records", () => {
    const columns: ColumnInfo[] = [
      {
        name: "age",
        dtype: "float64",
        unique_count: 50,
        suggested_type: "numeric",
        suggested_excluded: false,
        exclude_reason: null,
      } as ColumnInfo,
      {
        name: "id",
        dtype: "int64",
        unique_count: 100,
        suggested_type: "numeric",
        suggested_excluded: true,
        exclude_reason: "id",
      } as ColumnInfo,
    ];
    const result = buildOverridesFromColumns(columns);
    expect(result).toEqual({
      age: { excluded: false, type: "numeric" },
      id: { excluded: true, type: "numeric" },
    });
  });

  it("returns empty object for empty columns", () => {
    expect(buildOverridesFromColumns([])).toEqual({});
  });
});

describe("buildMergedConfig", () => {
  it("merges defaults with overrides, task, target, and split", () => {
    const defaults = {
      config_version: 1,
      data: { path: null },
      features: { categorical: [] },
      model: { name: "lgbm" },
    };
    const overrides = {
      age: { excluded: false, type: "numeric" as const },
      color: { excluded: false, type: "categorical" as const },
      id: { excluded: true, type: "numeric" as const },
    };
    const result = buildMergedConfig({
      defaults,
      task: "binary",
      strategy: "kfold",
      folds: 5,
      dataPath: "/data/train.csv",
      target: "survived",
      overrides,
    });

    expect(result.task).toBe("binary");
    expect(result.data).toMatchObject({
      path: "/data/train.csv",
      target: "survived",
    });
    expect(result.features).toEqual({
      categorical: ["color"],
      exclude: ["id"],
    });
    expect(result.split).toEqual({ method: "kfold", n_splits: 5 });
  });

  it("sets path to undefined when dataPath is empty", () => {
    const result = buildMergedConfig({
      defaults: { data: {}, features: {} },
      task: "binary",
      strategy: "kfold",
      folds: 5,
      dataPath: "",
      target: "y",
      overrides: {},
    });
    expect(result.data).toMatchObject({ path: undefined, target: "y" });
  });
});

describe("extractOverrideArrays", () => {
  it("separates categorical and excluded columns", () => {
    const overrides = {
      age: { excluded: false, type: "numeric" as const },
      color: { excluded: false, type: "categorical" as const },
      id: { excluded: true, type: "numeric" as const },
      city: { excluded: true, type: "categorical" as const },
    };
    const result = extractOverrideArrays(overrides);
    expect(result.categorical).toEqual(["color"]);
    expect(result.excluded).toEqual(["id", "city"]);
  });

  it("returns empty arrays for empty overrides", () => {
    const result = extractOverrideArrays({});
    expect(result.categorical).toEqual([]);
    expect(result.excluded).toEqual([]);
  });
});

describe("buildSyncKey", () => {
  it("produces a stable JSON string for the same inputs", () => {
    const key1 = buildSyncKey(
      "target",
      "binary",
      {},
      { strategy: "kfold" },
      {},
    );
    const key2 = buildSyncKey(
      "target",
      "binary",
      {},
      { strategy: "kfold" },
      {},
    );
    expect(key1).toBe(key2);
  });

  it("produces different keys for different inputs", () => {
    const key1 = buildSyncKey("a", "binary", {}, {}, {});
    const key2 = buildSyncKey("b", "binary", {}, {}, {});
    expect(key1).not.toBe(key2);
  });
});
