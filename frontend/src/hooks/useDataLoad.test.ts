import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDataFromPath: vi.fn(),
  uploadData: vi.fn(),
  fetchPreview: vi.fn(),
  fetchColumns: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/api/workspace", () => ({
  loadDataFromPath: mocks.loadDataFromPath,
  uploadData: mocks.uploadData,
  fetchPreview: mocks.fetchPreview,
  fetchColumns: mocks.fetchColumns,
  fetchColumnStats: vi.fn(),
  fetchConfig: vi.fn(),
  fetchConfigDefaults: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { useDataLoad } from "./useDataLoad";

const DATA_LOAD_OK = {
  data_ref: { path: "/data/x.csv", shape: [100, 5] as [number, number] },
};

const COLS_OK = {
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
    },
  ],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper };
}

describe("useDataLoad", () => {
  const defaultParams = {
    onDataChanged: vi.fn(),
    onTaskChanged: vi.fn(),
    onColumnsLoaded: vi.fn(),
    onReset: vi.fn(),
  };

  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset?.();
    mocks.fetchPreview.mockResolvedValue({ columns: [], data: [] });
    defaultParams.onDataChanged = vi.fn();
    defaultParams.onTaskChanged = vi.fn();
    defaultParams.onColumnsLoaded = vi.fn();
    defaultParams.onReset = vi.fn();
  });

  it("handleLoadPathByValue populates shape and calls callbacks", async () => {
    mocks.loadDataFromPath.mockResolvedValue(DATA_LOAD_OK);
    mocks.fetchColumns.mockResolvedValue(COLS_OK);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDataLoad(defaultParams), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleLoadPathByValue("/data/x.csv");
    });

    expect(result.current.shape).toEqual([100, 5]);
    expect(defaultParams.onColumnsLoaded).toHaveBeenCalledWith(
      COLS_OK.columns,
      ["a"],
    );
    expect(defaultParams.onReset).toHaveBeenCalled();
    expect(defaultParams.onDataChanged).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("handleLoadPathByValue shows toast on failure", async () => {
    mocks.loadDataFromPath.mockRejectedValue(new Error("not found"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDataLoad(defaultParams), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleLoadPathByValue("/bad.csv");
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load data"),
    );
    expect(result.current.loading).toBe(false);
  });

  it("handleLoadPathByValue skips empty input", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDataLoad(defaultParams), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleLoadPathByValue("   ");
    });

    expect(mocks.loadDataFromPath).not.toHaveBeenCalled();
  });

  it("handleUpload populates shape and dataPath", async () => {
    mocks.uploadData.mockResolvedValue(DATA_LOAD_OK);
    mocks.fetchColumns.mockResolvedValue(COLS_OK);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDataLoad(defaultParams), {
      wrapper,
    });

    const file = new File(["a,b\n1,2"], "x.csv", { type: "text/csv" });
    const event = {
      target: { files: [file] as unknown as FileList },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleUpload(event);
    });

    expect(result.current.shape).toEqual([100, 5]);
    expect(result.current.dataPath).toBe("/data/x.csv");
    expect(defaultParams.onColumnsLoaded).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("handleUpload shows toast on failure", async () => {
    mocks.uploadData.mockRejectedValue(new Error("too large"));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDataLoad(defaultParams), {
      wrapper,
    });

    const file = new File(["a"], "x.csv", { type: "text/csv" });
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

  it("handleUpload does nothing when no file selected", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDataLoad(defaultParams), {
      wrapper,
    });

    const event = {
      target: { files: [] as unknown as FileList },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleUpload(event);
    });

    expect(mocks.uploadData).not.toHaveBeenCalled();
  });

  it("initial state is correct", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDataLoad(defaultParams), {
      wrapper,
    });

    expect(result.current.sourceType).toBe("upload");
    expect(result.current.dataPath).toBe("");
    expect(result.current.shape).toBeNull();
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
