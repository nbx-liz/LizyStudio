import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import type { ColumnInfo, ColumnsResponse, UiSchema } from "@/api/types";

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

function createWrapper(): {
  wrapper: ({ children }: { children: ReactNode }) => ReactNode;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

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
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged, onTaskChanged }),
      { wrapper },
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

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged: vi.fn() }),
      { wrapper },
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
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged: vi.fn() }),
      { wrapper },
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

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged: vi.fn() }),
      { wrapper },
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

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged: vi.fn() }),
      { wrapper },
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

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged: vi.fn() }),
      { wrapper },
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

  // --- Issue #107: handleTargetChange broadcasts merged config ---

  it("handleTargetChange seeds the 'config' query cache with the merged config", async () => {
    // Regression guard for Issue #107. When target selection completes,
    // the merged defaults-backed config must be written into the React
    // Query cache so ModelPanel's useQuery(['config']) sees the full
    // config immediately. Without this, any ConfigForm effect that fires
    // on task change can PUT a partial config derived from an empty
    // cached value, producing transient "Field required" validation
    // errors from the Pydantic validator on the server.
    mocks.fetchColumns.mockResolvedValue(COLS_OK);
    mocks.fetchConfigDefaults.mockResolvedValue({
      config_version: 1,
      task: "binary",
      data: { path: null, target: null },
      features: { categorical: [], exclude: [] },
      split: { method: "kfold", n_splits: 5 },
      model: { name: "lgbm", params: {} },
    });

    const { wrapper, queryClient } = createWrapper();
    const { result } = renderHook(
      () =>
        useDataPanel({
          onDataChanged: vi.fn(),
          onTaskChanged: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleTargetChange("a");
    });

    // updateConfig must have been called exactly once with a fully
    // validatable config.
    expect(mocks.updateConfig).toHaveBeenCalledTimes(1);
    const merged = mocks.updateConfig.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(merged.config_version).toBe(1);
    expect(merged.task).toBe("binary");
    expect(merged.data).toMatchObject({ target: "a" });

    // The merged config must be present in the query cache so the
    // ModelPanel-side useQuery(['config']) consumer sees it without
    // waiting for a refetch.
    const cached = queryClient.getQueryData(queryKeys.config());
    expect(cached).toEqual(merged);
  });

  // --- C-5b: uiSchema.capabilities.cv_default_strategy overrides hard-coded fallback ---

  it("handleTargetChange uses uiSchema.capabilities.cv_default_strategy when provided", async () => {
    mocks.fetchColumns.mockResolvedValue(COLS_OK);
    mocks.fetchConfigDefaults.mockResolvedValue({
      config_version: 1,
      task: "binary",
      data: { path: null, target: null },
      features: { categorical: [], exclude: [] },
      split: { method: "kfold", n_splits: 5 },
      model: { name: "lgbm", params: {} },
    });

    const uiSchema = {
      capabilities: {
        cv_default_strategy: { binary: "group_kfold" },
        cv_strategies: ["kfold", "stratified_kfold", "group_kfold"],
        tune: { allow_empty_space: true },
      },
    } as unknown as UiSchema;

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged: vi.fn(), uiSchema }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleTargetChange("a");
    });

    expect(result.current.cv.strategy).toBe("group_kfold");
  });

  it("handleTargetChange falls back to hard-coded default when uiSchema is absent", async () => {
    mocks.fetchColumns.mockResolvedValue(COLS_OK);
    mocks.fetchConfigDefaults.mockResolvedValue({
      config_version: 1,
      task: "binary",
      data: { path: null, target: null },
      features: { categorical: [], exclude: [] },
      split: { method: "kfold", n_splits: 5 },
      model: { name: "lgbm", params: {} },
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged: vi.fn() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleTargetChange("a");
    });

    // Binary task → stratified_kfold (hard-coded fallback).
    expect(result.current.cv.strategy).toBe("stratified_kfold");
  });

  it("handleTaskChange uses uiSchema.capabilities.cv_default_strategy when provided", () => {
    const uiSchema = {
      capabilities: {
        cv_default_strategy: { regression: "time_series" },
        cv_strategies: ["kfold", "time_series"],
        tune: { allow_empty_space: true },
      },
    } as unknown as UiSchema;

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useDataPanel({ onDataChanged: vi.fn(), uiSchema }),
      { wrapper },
    );

    act(() => {
      result.current.handleTaskChange("regression");
    });

    expect(result.current.cv.strategy).toBe("time_series");
  });

  // -------------------------------------------------------------------------
  // P-0090 / Issue #278 residual: when an external write updates the cached
  // config (e.g. handleLoadPreset → setQueryData with n_splits=5), the
  // controlled inputs in CvSection must re-render to the new value. The
  // inputs are bound to useDataPanel's local `cv` state, which has no
  // subscription to the config cache, so without an explicit back-sync the
  // Folds NumberInput stays stuck at the pre-preset value (8) until a full
  // page reload re-derives the state. The hook subscribes to the
  // queryKeys.config() cache and reconciles cv.folds / cv.strategy / etc.
  // when the cache value diverges from local state.
  // -------------------------------------------------------------------------
  describe("back-sync from config cache (#278 residual / setQueryData input race)", () => {
    it("updates cv.folds when an external setQueryData writes a new n_splits", async () => {
      const { wrapper, queryClient } = createWrapper();
      const { result } = renderHook(
        () => useDataPanel({ onDataChanged: vi.fn() }),
        { wrapper },
      );

      // Initial state: defaults — folds=5 (per CV_FIELD_DEFAULTS).
      expect(result.current.cv.folds).toBe(5);

      // Simulate an external write (e.g. preset Load or
      // useConfigSync's new setQueryData path) that drops a new
      // config into the TanStack Query cache.
      act(() => {
        queryClient.setQueryData(queryKeys.config(), {
          config_version: 1,
          task: "binary",
          split: { method: "stratified_kfold", n_splits: 8, random_state: 42 },
        });
      });

      await waitFor(() => expect(result.current.cv.folds).toBe(8));
      expect(result.current.cv.strategy).toBe("stratified_kfold");
    });

    it("updates cv.strategy when external config switches the CV method", async () => {
      const { wrapper, queryClient } = createWrapper();
      const { result } = renderHook(
        () => useDataPanel({ onDataChanged: vi.fn() }),
        { wrapper },
      );

      act(() => {
        queryClient.setQueryData(queryKeys.config(), {
          config_version: 1,
          task: "regression",
          split: { method: "time_series", n_splits: 4 },
        });
      });

      await waitFor(() =>
        expect(result.current.cv.strategy).toBe("time_series"),
      );
      expect(result.current.cv.folds).toBe(4);
    });

    // Issue #358: BlockedGroup CV strategy click never sticks because a
    // concurrent stale cache write re-fires the reconcile effect and
    // reverts ``cv.strategy`` to the previously-cached value before the
    // user-driven PUT lands. The fix latches the user's chosen strategy
    // so reconcile bails on cache writes that disagree with it, and
    // clears the latch once the cache catches up.
    it("does not revert cv.strategy when a stale cache update fires after setCvFromUser", async () => {
      const { wrapper, queryClient } = createWrapper();
      const { result } = renderHook(
        () => useDataPanel({ onDataChanged: vi.fn() }),
        { wrapper },
      );

      // Seed the cache with the strategy the user is about to switch
      // away from. This is the "previous" value that, without the fix,
      // a stale subscriber callback would push back into local state.
      act(() => {
        queryClient.setQueryData(queryKeys.config(), {
          config_version: 1,
          task: "binary",
          split: { method: "stratified_kfold", n_splits: 5 },
        });
      });
      await waitFor(() =>
        expect(result.current.cv.strategy).toBe("stratified_kfold"),
      );

      // User picks BlockedGroup via the segment buttons (CvSection
      // wires this to ``setCvFromUser``).
      act(() => {
        result.current.setCvFromUser({
          ...result.current.cv,
          strategy: "blocked_group_kfold",
        });
      });
      expect(result.current.cv.strategy).toBe("blocked_group_kfold");

      // Simulate the stale cache update that arrives while the user-
      // driven PUT is still in flight. Without the latch this would
      // trigger reconcile to setCv back to ``stratified_kfold``.
      act(() => {
        queryClient.setQueryData(queryKeys.config(), {
          config_version: 1,
          task: "binary",
          split: { method: "stratified_kfold", n_splits: 5 },
        });
      });
      // Give the subscriber callback time to fire.
      await new Promise((r) => setTimeout(r, 30));

      // Local state stays at the user's choice — NOT reverted.
      expect(result.current.cv.strategy).toBe("blocked_group_kfold");
    });

    it("clears the latch and resumes back-sync once the cache catches up to the user's choice", async () => {
      const { wrapper, queryClient } = createWrapper();
      const { result } = renderHook(
        () => useDataPanel({ onDataChanged: vi.fn() }),
        { wrapper },
      );

      // User picks BlockedGroup.
      act(() => {
        result.current.setCvFromUser({
          ...result.current.cv,
          strategy: "blocked_group_kfold",
        });
      });
      expect(result.current.cv.strategy).toBe("blocked_group_kfold");

      // PUT lands; cache catches up to the user's choice.
      act(() => {
        queryClient.setQueryData(queryKeys.config(), {
          config_version: 1,
          task: "binary",
          split: { method: "blocked_group_kfold", n_splits: 5 },
        });
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(result.current.cv.strategy).toBe("blocked_group_kfold");

      // After the latch clears, a legitimate external write (e.g.
      // Load Preset) must still drive local state.
      act(() => {
        queryClient.setQueryData(queryKeys.config(), {
          config_version: 1,
          task: "regression",
          split: { method: "time_series", n_splits: 4 },
        });
      });
      await waitFor(() =>
        expect(result.current.cv.strategy).toBe("time_series"),
      );
    });

    it("does not write back to the cache when reconciling from external state", async () => {
      const { wrapper, queryClient } = createWrapper();
      renderHook(() => useDataPanel({ onDataChanged: vi.fn() }), { wrapper });

      // Reset call count so we observe only post-back-sync writes.
      mocks.updateConfig.mockClear();

      act(() => {
        queryClient.setQueryData(queryKeys.config(), {
          config_version: 1,
          task: "binary",
          split: { method: "kfold", n_splits: 7 },
        });
      });

      // Allow the back-sync effect to run and any erroneous useConfigSync
      // re-fire to settle.
      await new Promise((r) => setTimeout(r, 30));
      // Back-sync must not echo the cached value back to the server —
      // that would loop infinitely. Without target set the sync effect
      // is gated, so updateConfig should remain at zero calls.
      expect(mocks.updateConfig).not.toHaveBeenCalled();
    });
  });
});

// --- Issue #128: pure helper unit tests ---

import { buildMergedConfig, buildOverridesFromColumns } from "./useDataPanel";

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
      {
        name: "color",
        dtype: "object",
        unique_count: 3,
        suggested_type: "categorical",
        suggested_excluded: false,
        exclude_reason: null,
      } as ColumnInfo,
    ];
    const result = buildOverridesFromColumns(columns);
    expect(result).toEqual({
      age: { excluded: false, type: "numeric" },
      id: { excluded: true, type: "numeric" },
      color: { excluded: false, type: "categorical" },
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
      task: "binary",
      data: { path: null, target: null },
      features: { categorical: [], exclude: [] },
      split: { method: "kfold", n_splits: 5 },
      model: { name: "lgbm", params: {} },
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

    expect(result.config_version).toBe(1);
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
    expect(result.model).toEqual({ name: "lgbm", params: {} });
  });

  it("sets path to undefined when dataPath is empty", () => {
    const defaults = {
      data: {},
      features: {},
      split: {},
    };
    const result = buildMergedConfig({
      defaults,
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
