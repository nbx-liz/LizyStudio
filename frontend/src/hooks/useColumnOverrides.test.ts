import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "@/api/types";

const mocks = vi.hoisted(() => ({
  fetchColumnStats: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/api/workspace", () => ({
  fetchColumnStats: mocks.fetchColumnStats,
  loadDataFromPath: vi.fn(),
  uploadData: vi.fn(),
  fetchPreview: vi.fn(),
  fetchColumns: vi.fn(),
  fetchConfig: vi.fn(),
  fetchConfigDefaults: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { useColumnOverrides } from "./useColumnOverrides";

const COLUMNS: ColumnInfo[] = [
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
  {
    name: "color",
    dtype: "object",
    unique_count: 3,
    suggested_type: "categorical",
    suggested_excluded: false,
    exclude_reason: null,
  } as ColumnInfo,
  {
    name: "const_col",
    dtype: "int64",
    unique_count: 1,
    suggested_type: "numeric",
    suggested_excluded: true,
    exclude_reason: "constant",
  } as ColumnInfo,
];

describe("useColumnOverrides", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset?.();
  });

  it("initial state has empty overrides", () => {
    const { result } = renderHook(() =>
      useColumnOverrides({ columns: COLUMNS, target: "age" }),
    );
    expect(result.current.overrides).toEqual({});
    expect(result.current.columnFilter).toBe("");
    expect(result.current.expandedCol).toBeNull();
  });

  it("handleExcludeToggle updates overrides immutably", () => {
    const { result } = renderHook(() =>
      useColumnOverrides({ columns: COLUMNS, target: "age" }),
    );

    act(() => {
      result.current.handleExcludeToggle("color", true);
    });

    expect(result.current.overrides.color).toEqual(
      expect.objectContaining({ excluded: true }),
    );
  });

  it("handleTypeChange updates column type", () => {
    const { result } = renderHook(() =>
      useColumnOverrides({ columns: COLUMNS, target: "age" }),
    );

    act(() => {
      result.current.handleTypeChange("color", "numeric");
    });

    expect(result.current.overrides.color).toEqual(
      expect.objectContaining({ type: "numeric" }),
    );
  });

  it("handleColumnExpand fetches and caches stats", async () => {
    mocks.fetchColumnStats.mockResolvedValue({
      name: "age",
      dtype: "float64",
      unique_count: 50,
      total_count: 100,
      null_count: 0,
      value_counts: [],
    });

    const { result } = renderHook(() =>
      useColumnOverrides({ columns: COLUMNS, target: null }),
    );

    await act(async () => {
      await result.current.handleColumnExpand("age");
    });

    await waitFor(() => {
      expect(result.current.expandedCol).toBe("age");
      expect(result.current.colStats.age).toBeDefined();
    });
    expect(mocks.fetchColumnStats).toHaveBeenCalledTimes(1);

    // Collapse and re-expand: should not re-fetch
    await act(async () => {
      await result.current.handleColumnExpand("age");
    });
    await act(async () => {
      await result.current.handleColumnExpand("age");
    });
    expect(mocks.fetchColumnStats).toHaveBeenCalledTimes(1);
  });

  it("handleColumnExpand shows toast on error", async () => {
    mocks.fetchColumnStats.mockRejectedValue(new Error("unavailable"));

    const { result } = renderHook(() =>
      useColumnOverrides({ columns: COLUMNS, target: null }),
    );

    await act(async () => {
      await result.current.handleColumnExpand("age");
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load column stats"),
    );
  });

  it("summary computes correct counts", () => {
    const { result } = renderHook(() =>
      useColumnOverrides({ columns: COLUMNS, target: "age" }),
    );

    // Set overrides to match suggested values
    act(() => {
      result.current.setOverrides({
        id: { excluded: true, type: "numeric" },
        color: { excluded: false, type: "categorical" },
        const_col: { excluded: true, type: "numeric" },
      });
    });

    // target="age" is excluded from counts; remaining: id, color, const_col
    expect(result.current.summary.total).toBe(3);
    expect(result.current.summary.excluded).toBe(2); // id + const_col
    expect(result.current.summary.numeric).toBe(0); // only color is included, it's categorical
    expect(result.current.summary.categorical).toBe(1); // color
    expect(result.current.summary.idCount).toBe(1);
    expect(result.current.summary.constCount).toBe(1);
    expect(result.current.summary.manualCount).toBe(0);
  });

  it("nonExcludedCols filters out target and excluded columns", () => {
    const { result } = renderHook(() =>
      useColumnOverrides({ columns: COLUMNS, target: "age" }),
    );

    act(() => {
      result.current.setOverrides({
        id: { excluded: true, type: "numeric" },
        color: { excluded: false, type: "categorical" },
        const_col: { excluded: false, type: "numeric" },
      });
    });

    const names = result.current.nonExcludedCols.map((c) => c.name);
    expect(names).toEqual(["color", "const_col"]);
    expect(names).not.toContain("age");
    expect(names).not.toContain("id");
  });
});
