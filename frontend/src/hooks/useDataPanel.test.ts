import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo, ColumnsResponse } from "@/api/types";

const mocks = vi.hoisted(() => ({
  loadDataFromPath: vi.fn(),
  uploadData: vi.fn(),
  fetchPreview: vi.fn(),
  fetchColumns: vi.fn(),
  fetchColumnStats: vi.fn(),
  fetchConfig: vi.fn(),
  fetchConfigDefaults: vi.fn(),
  updateConfig: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/api/workspace", () => ({
  loadDataFromPath: mocks.loadDataFromPath,
  uploadData: mocks.uploadData,
  fetchPreview: mocks.fetchPreview,
  fetchColumns: mocks.fetchColumns,
  fetchColumnStats: mocks.fetchColumnStats,
  fetchConfig: mocks.fetchConfig,
  fetchConfigDefaults: mocks.fetchConfigDefaults,
  updateConfig: mocks.updateConfig,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { useDataPanel } from "./useDataPanel";

const DATA_LOAD_OK = {
  data_ref: { path: "/data/x.csv", shape: [100, 5] as [number, number] },
};

const COLS_OK: ColumnsResponse = {
  target: null,
  suggested_task: "binary",
  columns: [
    {
      name: "a",
      dtype: "float64",
      unique_count: 10,
      suggested_type: "numeric",
      suggested_excluded: false,
      exclude_reason: null,
    } as ColumnInfo,
    {
      name: "b",
      dtype: "object",
      unique_count: 4,
      suggested_type: "categorical",
      suggested_excluded: false,
      exclude_reason: null,
    } as ColumnInfo,
  ],
};

describe("useDataPanel", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset?.();
    mocks.fetchConfig.mockResolvedValue({});
    mocks.updateConfig.mockResolvedValue(undefined);
    mocks.fetchPreview.mockResolvedValue({ columns: [], data: [] });
  });

  // --- loadDataFromPath happy + error ---

  it("loadDataFromPath populates shape, preview, columns and fires callbacks", async () => {
    mocks.loadDataFromPath.mockResolvedValue(DATA_LOAD_OK);
    mocks.fetchColumns.mockResolvedValue(COLS_OK);

    const onDataChanged = vi.fn();
    const onTaskChanged = vi.fn();
    const { result } = renderHook(() =>
      useDataPanel({ onDataChanged, onTaskChanged }),
    );

    await act(async () => {
      await result.current.handleLoadPathByValue("/data/x.csv");
    });

    expect(mocks.loadDataFromPath).toHaveBeenCalledWith("/data/x.csv");
    expect(result.current.shape).toEqual([100, 5]);
    expect(result.current.columns).toHaveLength(2);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
    expect(onTaskChanged).toHaveBeenCalledWith(null);
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("loadDataFromPath reverts loading to false and shows toast on failure", async () => {
    mocks.loadDataFromPath.mockRejectedValue(new Error("path not found"));

    const { result } = renderHook(() =>
      useDataPanel({ onDataChanged: vi.fn() }),
    );

    await act(async () => {
      await result.current.handleLoadPathByValue("/does/not/exist.csv");
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load data"),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.shape).toBeNull();
  });

  it("loadDataFromPath skips empty input silently", async () => {
    const { result } = renderHook(() =>
      useDataPanel({ onDataChanged: vi.fn() }),
    );

    await act(async () => {
      await result.current.handleLoadPathByValue("   ");
    });

    expect(mocks.loadDataFromPath).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  // --- uploadData error path ---

  it("uploadData error keeps loading=false", async () => {
    mocks.uploadData.mockRejectedValue(new Error("too large"));

    const { result } = renderHook(() =>
      useDataPanel({ onDataChanged: vi.fn() }),
    );

    const file = new File(["a,b\n1,2"], "x.csv", { type: "text/csv" });
    const event = {
      target: { files: [file] as unknown as FileList },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleUpload(event);
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("Upload failed"),
    );
    expect(result.current.loading).toBe(false);
  });

  // --- handleColumnExpand ---

  it("handleColumnExpand caches stats per column", async () => {
    mocks.fetchColumnStats.mockImplementation(async (name: string) => ({
      name,
      dtype: "int64",
      unique_count: 10,
      total_count: 100,
      null_count: 0,
      value_counts: [{ value: "1", count: 50 }],
    }));

    const { result } = renderHook(() =>
      useDataPanel({ onDataChanged: vi.fn() }),
    );

    await act(async () => {
      await result.current.handleColumnExpand("a");
    });
    await waitFor(() => {
      expect(result.current.expandedCol).toBe("a");
      expect(result.current.colStats.a).toBeDefined();
    });
    expect(mocks.fetchColumnStats).toHaveBeenCalledTimes(1);

    // Expanding again should NOT re-fetch (cached).
    await act(async () => {
      await result.current.handleColumnExpand("a"); // collapse
    });
    await act(async () => {
      await result.current.handleColumnExpand("a"); // re-expand
    });
    expect(mocks.fetchColumnStats).toHaveBeenCalledTimes(1);
  });

  it("handleColumnExpand surfaces errors via toast instead of failing silently", async () => {
    // Currently the hook swallows errors silently. This test documents
    // the desired behaviour: the user should at least see a toast so
    // they know why the bar did not render. Marked as the regression
    // marker for HIGH-1.
    mocks.fetchColumnStats.mockRejectedValue(new Error("stats unavailable"));

    const { result } = renderHook(() =>
      useDataPanel({ onDataChanged: vi.fn() }),
    );

    await act(async () => {
      await result.current.handleColumnExpand("a");
    });

    expect(result.current.expandedCol).toBe("a");
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load column stats"),
    );
    // colStats[a] must remain undefined so later code can branch correctly.
    expect(result.current.colStats.a).toBeUndefined();
  });
});
