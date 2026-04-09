import { describe, expect, it } from "vitest";
import { filterInnerValidOptions, recommendedInnerValid } from "./cv-state";

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
