import { describe, expect, it } from "vitest";
import {
  filterInnerValidOptions,
  pruneInnerValidForMethod,
  recommendedInnerValid,
} from "./cv-state";

const ALL_OPTIONS = ["holdout", "group_holdout", "time_holdout"];

describe("filterInnerValidOptions", () => {
  it("kfold → holdout only", () => {
    expect(filterInnerValidOptions(ALL_OPTIONS, "kfold")).toEqual(["holdout"]);
  });

  it("stratified_kfold → holdout only", () => {
    expect(filterInnerValidOptions(ALL_OPTIONS, "stratified_kfold")).toEqual([
      "holdout",
    ]);
  });

  it("group_kfold → holdout + group_holdout", () => {
    expect(filterInnerValidOptions(ALL_OPTIONS, "group_kfold")).toEqual([
      "holdout",
      "group_holdout",
    ]);
  });

  it("stratified_group_kfold → holdout + group_holdout", () => {
    expect(
      filterInnerValidOptions(ALL_OPTIONS, "stratified_group_kfold"),
    ).toEqual(["holdout", "group_holdout"]);
  });

  it("time_series → holdout + time_holdout", () => {
    expect(filterInnerValidOptions(ALL_OPTIONS, "time_series")).toEqual([
      "holdout",
      "time_holdout",
    ]);
  });

  it("purged_time_series → holdout + time_holdout", () => {
    expect(filterInnerValidOptions(ALL_OPTIONS, "purged_time_series")).toEqual([
      "holdout",
      "time_holdout",
    ]);
  });

  it("group_time_series → all three", () => {
    expect(filterInnerValidOptions(ALL_OPTIONS, "group_time_series")).toEqual(
      ALL_OPTIONS,
    );
  });

  it("blocked_group_kfold → holdout + group_holdout", () => {
    expect(filterInnerValidOptions(ALL_OPTIONS, "blocked_group_kfold")).toEqual(
      ["holdout", "group_holdout"],
    );
  });

  it("unknown strategy → holdout only", () => {
    expect(filterInnerValidOptions(ALL_OPTIONS, "unknown")).toEqual([
      "holdout",
    ]);
  });

  it("empty options → empty", () => {
    expect(filterInnerValidOptions([], "kfold")).toEqual([]);
  });
});

describe("recommendedInnerValid", () => {
  it("group_kfold → group_holdout", () => {
    expect(recommendedInnerValid("group_kfold")).toBe("group_holdout");
  });

  it("time_series → time_holdout", () => {
    expect(recommendedInnerValid("time_series")).toBe("time_holdout");
  });

  it("kfold → holdout", () => {
    expect(recommendedInnerValid("kfold")).toBe("holdout");
  });

  it("stratified_kfold → holdout", () => {
    expect(recommendedInnerValid("stratified_kfold")).toBe("holdout");
  });
});

// P-0092 follow-up (2026-04-30): pruning inner_valid fields by the
// new method's allowed schema. Mirrors the lizyml Pydantic schema:
//   - holdout:        method, ratio, stratify, random_state
//   - group_holdout:  method, ratio, random_state          (no stratify)
//   - time_holdout:   method, ratio                        (no stratify, no random_state)
//
// The fix landed because clicking GroupKFold while inner_valid was on
// holdout previously kept `stratify: false` in the body, which
// GroupHoldoutInnerValidConfig rejects with `extra="forbid"`. The
// 5 group/time strategies in B-3 spec exposed this for all of them.
describe("pruneInnerValidForMethod", () => {
  it("strips stratify when switching from holdout → group_holdout", () => {
    const before = {
      method: "holdout",
      ratio: 0.2,
      stratify: false,
      random_state: 42,
    };
    expect(pruneInnerValidForMethod(before, "group_holdout")).toEqual({
      method: "group_holdout",
      ratio: 0.2,
      random_state: 42,
    });
  });

  it("strips stratify and random_state when switching from holdout → time_holdout", () => {
    const before = {
      method: "holdout",
      ratio: 0.15,
      stratify: true,
      random_state: 7,
    };
    expect(pruneInnerValidForMethod(before, "time_holdout")).toEqual({
      method: "time_holdout",
      ratio: 0.15,
    });
  });

  it("preserves all fields when staying on holdout", () => {
    const before = {
      method: "holdout",
      ratio: 0.3,
      stratify: true,
      random_state: 1,
    };
    expect(pruneInnerValidForMethod(before, "holdout")).toEqual({
      method: "holdout",
      ratio: 0.3,
      stratify: true,
      random_state: 1,
    });
  });

  it("returns method change when source has no shared fields", () => {
    expect(pruneInnerValidForMethod({}, "group_holdout")).toEqual({
      method: "group_holdout",
    });
  });

  it("does not invent fields not present in source", () => {
    const before = { method: "time_holdout", ratio: 0.1 };
    // group_holdout allows random_state, but source has no random_state.
    expect(pruneInnerValidForMethod(before, "group_holdout")).toEqual({
      method: "group_holdout",
      ratio: 0.1,
    });
  });

  it("passes through unchanged for unknown methods (forward-compat)", () => {
    const before = { method: "holdout", ratio: 0.1, stratify: true };
    // future method we don't know about: keep current fields, just
    // update method, so the backend can surface the schema error.
    expect(pruneInnerValidForMethod(before, "future_method")).toEqual({
      method: "future_method",
      ratio: 0.1,
      stratify: true,
    });
  });
});
