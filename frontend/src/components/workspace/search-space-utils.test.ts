import { describe, expect, it } from "vitest";
import { findEmptyChoiceKeys } from "./search-space-utils";

describe("findEmptyChoiceKeys (Issue #266)", () => {
  it("returns empty list for empty space", () => {
    expect(findEmptyChoiceKeys({})).toEqual([]);
  });

  it("ignores Range entries", () => {
    const space = {
      learning_rate: { type: "float", low: 0.001, high: 0.1, log: false },
      n_estimators: { type: "int", low: 100, high: 1000, log: false },
    };
    expect(findEmptyChoiceKeys(space)).toEqual([]);
  });

  it("ignores Choice entries with at least one choice", () => {
    const space = {
      objective: { type: "categorical", choices: ["binary", "huber"] },
      metric: { type: "categorical", choices: ["auc"] },
    };
    expect(findEmptyChoiceKeys(space)).toEqual([]);
  });

  it("flags Choice entries with empty choices array", () => {
    const space = {
      objective: { type: "categorical", choices: [] },
    };
    expect(findEmptyChoiceKeys(space)).toEqual(["objective"]);
  });

  it("flags Choice entries when choices is missing entirely", () => {
    const space = {
      objective: { type: "categorical" },
    };
    expect(findEmptyChoiceKeys(space)).toEqual(["objective"]);
  });

  it("flags multiple offending entries while ignoring valid ones", () => {
    const space = {
      learning_rate: { type: "float", low: 0.001, high: 0.1, log: false },
      objective: { type: "categorical", choices: [] },
      metric: { type: "categorical", choices: ["auc"] },
      verbose: { type: "categorical", choices: [] },
    };
    expect(findEmptyChoiceKeys(space).sort()).toEqual(["objective", "verbose"]);
  });

  it("ignores non-object values without throwing", () => {
    const space: Record<string, unknown> = {
      a: null,
      b: undefined,
      c: 42,
      d: "string",
      objective: { type: "categorical", choices: [] },
    };
    expect(findEmptyChoiceKeys(space)).toEqual(["objective"]);
  });
});
