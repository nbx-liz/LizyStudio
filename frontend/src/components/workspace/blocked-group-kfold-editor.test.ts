/**
 * Tests for BlockedGroupKFoldEditor pure functions: derivePeriods.
 */
import { describe, expect, it } from "vitest";
import type { ValueCount } from "@/api/types";
import {
  derivePeriods,
  INITIAL_BLOCKED_STATE,
} from "./BlockedGroupKFoldEditor";

describe("derivePeriods", () => {
  const values: ValueCount[] = [
    { value: "2020", count: 100 },
    { value: "2021", count: 200 },
    { value: "2022", count: 150 },
    { value: "2023", count: 180 },
    { value: "2024", count: 120 },
  ];

  it("returns empty array when values are empty", () => {
    expect(derivePeriods([], ["2020"])).toEqual([]);
  });

  it("returns empty array when cutoffs are empty", () => {
    expect(derivePeriods(values, [])).toEqual([]);
  });

  it("creates a single period when only last value is cutoff", () => {
    const result = derivePeriods(values, ["2024"]);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("P0");
    expect(result[0].values).toEqual(["2020", "2021", "2022", "2023", "2024"]);
    expect(result[0].rowCount).toBe(750);
  });

  it("creates two periods with one intermediate cutoff", () => {
    const result = derivePeriods(values, ["2022", "2024"]);
    expect(result).toHaveLength(2);

    expect(result[0].label).toBe("P0");
    expect(result[0].values).toEqual(["2020", "2021", "2022"]);
    expect(result[0].rowCount).toBe(450);

    expect(result[1].label).toBe("P1");
    expect(result[1].values).toEqual(["2023", "2024"]);
    expect(result[1].rowCount).toBe(300);
  });

  it("creates multiple periods with several cutoffs", () => {
    const result = derivePeriods(values, ["2021", "2023", "2024"]);
    expect(result).toHaveLength(3);

    expect(result[0].label).toBe("P0");
    expect(result[0].values).toEqual(["2020", "2021"]);
    expect(result[0].rowCount).toBe(300);

    expect(result[1].label).toBe("P1");
    expect(result[1].values).toEqual(["2022", "2023"]);
    expect(result[1].rowCount).toBe(330);

    expect(result[2].label).toBe("P2");
    expect(result[2].values).toEqual(["2024"]);
    expect(result[2].rowCount).toBe(120);
  });

  it("sorts cutoffs by index order even if provided out of order", () => {
    const result = derivePeriods(values, ["2024", "2021"]);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("P0");
    expect(result[0].values).toEqual(["2020", "2021"]);
    expect(result[1].label).toBe("P1");
    expect(result[1].values).toEqual(["2022", "2023", "2024"]);
  });

  it("ignores cutoff values not present in the values array", () => {
    const result = derivePeriods(values, ["2024", "nonexistent"]);
    expect(result).toHaveLength(1);
    expect(result[0].values).toEqual(["2020", "2021", "2022", "2023", "2024"]);
  });

  it("returns empty when all cutoffs are unknown", () => {
    expect(derivePeriods(values, ["unknown"])).toEqual([]);
  });
});

describe("INITIAL_BLOCKED_STATE", () => {
  it("has sensible defaults", () => {
    expect(INITIAL_BLOCKED_STATE.cutoffs).toEqual([]);
    expect(INITIAL_BLOCKED_STATE.blockMode).toBe("expanding");
    expect(INITIAL_BLOCKED_STATE.trainWindow).toBe(1);
    expect(INITIAL_BLOCKED_STATE.stratify).toBe("auto");
  });
});
