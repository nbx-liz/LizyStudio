import { describe, expect, it } from "vitest";
import { cn, formatNum } from "./utils";

describe("cn", () => {
  it("merges simple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("handles undefined and null inputs", () => {
    expect(cn("base", undefined, null)).toBe("base");
  });

  it("deduplicates conflicting Tailwind classes", () => {
    // twMerge should resolve conflicts: later class wins
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("handles array inputs via clsx", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });
});

describe("formatNum", () => {
  it("formats a number to 4 decimal places", () => {
    expect(formatNum(1.23456789)).toBe("1.2346");
  });

  it("pads numbers with fewer decimals", () => {
    expect(formatNum(1)).toBe("1.0000");
  });

  it("formats zero correctly", () => {
    expect(formatNum(0)).toBe("0.0000");
  });

  it("formats negative numbers", () => {
    expect(formatNum(-0.5)).toBe("-0.5000");
  });

  it("returns dash for NaN", () => {
    expect(formatNum(Number.NaN)).toBe("—");
  });

  it("returns dash for non-number types", () => {
    expect(formatNum("hello")).toBe("—");
    expect(formatNum(null)).toBe("—");
    expect(formatNum(undefined)).toBe("—");
    expect(formatNum(true)).toBe("—");
  });
});
