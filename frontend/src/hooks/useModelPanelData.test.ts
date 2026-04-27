/**
 * Tests for useModelPanelData — data + handlers backing ModelPanel.
 *
 * Focuses on the derived state (fitEnabled / tuneEnabled / disabledReason)
 * and the side-effect handlers (import / undo / redo / preset / change).
 * The individual useQuery wrappers are left to the existing ModelPanel
 * integration tests (ModelPanel.test.tsx) so we don't duplicate mock
 * wiring for the full config-schema / backend / columns fan-out.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { useModelPanelData } from "./useModelPanelData";

// All API calls are mocked — we only need to prove the hook wires them
// into the right query keys and computes the right derived state.
vi.mock("@/api/workspace", () => ({
  fetchBackends: vi
    .fn()
    .mockResolvedValue([{ name: "lizyml", version: "0.1" }]),
  fetchColumns: vi
    .fn()
    .mockResolvedValue({ columns: [{ name: "a", suggested_excluded: false }] }),
  fetchConfig: vi.fn().mockResolvedValue({ model: {} }),
  fetchConfigSchema: vi.fn().mockResolvedValue({ type: "object" }),
  fetchUiSchema: vi.fn().mockResolvedValue({}),
  getConfigDownloadUrl: vi.fn().mockReturnValue("/api/config/download"),
  // PUT /config returns { config, errors, saved } per ConfigUpdateResponse.
  // Default mock simulates a successful save so existing tests keep working.
  updateConfig: vi
    .fn()
    .mockResolvedValue({ config: {}, errors: [], saved: true }),
  uploadConfig: vi.fn().mockResolvedValue({ errors: [] }),
  validateConfig: vi.fn().mockResolvedValue({ errors: [] }),
}));

import {
  fetchColumns,
  fetchConfig,
  updateConfig,
  uploadConfig,
  validateConfig,
} from "@/api/workspace";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useModelPanelData", () => {
  // -------------------------------------------------------------------------
  // Column filtering
  // -------------------------------------------------------------------------
  it("filters suggested_excluded columns from nonExcludedColumns", async () => {
    vi.mocked(fetchColumns).mockResolvedValueOnce({
      columns: [
        { name: "a", suggested_excluded: false },
        { name: "b", suggested_excluded: true },
        { name: "c", suggested_excluded: false },
      ],
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useModelPanelData({ hasData: true }), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.nonExcludedColumns).toEqual(["a", "c"]);
    });
  });

  it("does NOT fetch columns until hasData is true", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useModelPanelData({ hasData: false }), { wrapper });

    await new Promise((r) => setTimeout(r, 30));
    expect(fetchColumns).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Derived enable/disable state
  // -------------------------------------------------------------------------
  it("fitEnabled requires hasData, config, not-running, no errors", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: false }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.config).toBeDefined());
    expect(result.current.fitEnabled).toBe(true);
  });

  it("fitEnabled is false while a job is running", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.config).toBeDefined());
    expect(result.current.fitEnabled).toBe(false);
    expect(result.current.disabledReason).toBe("A job is currently running");
  });

  it("fitEnabled is false when hasData is false (data guidance)", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: false, running: false }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.config).toBeDefined());
    expect(result.current.fitEnabled).toBe(false);
    expect(result.current.disabledReason).toBe("Load data first");
  });

  it("tuneEnabled requires a non-empty search space when capability disallows empty", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: false }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.config).toBeDefined());
    // default config has no tuning.optuna.space → tune disabled
    expect(result.current.tuneEnabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Issue #266: empty Choice validation gate
  // -------------------------------------------------------------------------
  it("flags empty Choice search-space entries via emptyChoiceKeys", async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      model: { name: "lgbm", params: {} },
      tuning: {
        optuna: {
          space: {
            objective: { type: "categorical", choices: [] },
            learning_rate: { type: "float", low: 0.001, high: 0.1, log: false },
            metric: { type: "categorical", choices: [] },
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useModelPanelData({
          hasData: true,
          running: false,
          activeTab: "tune",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.config).toBeDefined());
    expect(result.current.emptyChoiceKeys.sort()).toEqual([
      "metric",
      "objective",
    ]);
    expect(result.current.tuneEnabled).toBe(false);
    expect(result.current.disabledReason).toContain("Add at least one choice");
  });

  it("does not flag Choice entries that have at least one choice", async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      model: { name: "lgbm", params: {} },
      tuning: {
        optuna: {
          space: {
            objective: { type: "categorical", choices: ["binary"] },
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () =>
        useModelPanelData({
          hasData: true,
          running: false,
          activeTab: "tune",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.config).toBeDefined());
    expect(result.current.emptyChoiceKeys).toEqual([]);
    expect(result.current.tuneEnabled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // handleConfigChange
  // -------------------------------------------------------------------------
  it("handleConfigChange updates cache + calls validateConfig after debounce", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { wrapper, queryClient } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.config).toBeDefined());

    await act(async () => {
      await result.current.handleConfigChange({ model: { name: "LGBM" } });
    });

    expect(updateConfig).toHaveBeenCalledWith({ model: { name: "LGBM" } });
    expect(queryClient.getQueryData(queryKeys.config())).toEqual({
      model: { name: "LGBM" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(validateConfig).toHaveBeenCalledWith({ model: { name: "LGBM" } });

    vi.useRealTimers();
  });

  it("handleConfigChange is a no-op when running", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.config).toBeDefined());

    await act(async () => {
      await result.current.handleConfigChange({ model: { name: "LGBM" } });
    });

    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("handleConfigChange skips re-upload when new config equals cached", async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.config).toBeDefined());

    await act(async () => {
      // cached is {model: {}} from the default mock
      await result.current.handleConfigChange({ model: {} });
    });

    expect(updateConfig).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Issue #276: handleConfigChange must observe `saved:false` from the
  // backend and not silently swallow the rejection.
  //
  // Invariants under test:
  //   INV-A1: when updateConfig returns saved=false, the cached query data
  //           is NOT updated (frontend stays consistent with backend).
  //   INV-A2: when updateConfig returns saved=false, the rejection errors
  //           surface on the hook's `errors` state.
  //   INV-A3: when updateConfig returns saved=false, the change is NOT
  //           pushed to history (undo/redo would otherwise re-apply the
  //           unsaved config).
  // -------------------------------------------------------------------------
  describe("handleConfigChange — saved:false observation (#276)", () => {
    it("does not write to cache when backend returns saved=false", async () => {
      vi.mocked(updateConfig).mockResolvedValueOnce({
        config: { model: {} },
        errors: [{ path: "data", message: "Field required" }],
        saved: false,
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any);

      const { wrapper, queryClient } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      const before = queryClient.getQueryData(queryKeys.config());
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "X" } });
      });

      // Cache stays at backend's true state (not the rejected payload).
      expect(queryClient.getQueryData(queryKeys.config())).toEqual(before);
    });

    it("surfaces backend errors on the errors state when saved=false", async () => {
      const rejectionErrors = [
        { path: "data", message: "Field required" },
        { path: "split.method", message: "Invalid value" },
      ];
      vi.mocked(updateConfig).mockResolvedValueOnce({
        config: { model: {} },
        errors: rejectionErrors,
        saved: false,
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "X" } });
      });

      expect(result.current.errors).toEqual(rejectionErrors);
    });

    it("does not push rejected config onto history (undo would otherwise re-apply it)", async () => {
      vi.mocked(updateConfig).mockResolvedValueOnce({
        config: { model: {} },
        errors: [{ path: "data", message: "Field required" }],
        saved: false,
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      const undoBefore = result.current.history.canUndo;
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "X" } });
      });
      // Rejected change must not have been recorded in history.
      expect(result.current.history.canUndo).toBe(undoBefore);
    });

    it("clears errors when a subsequent successful change comes through", async () => {
      vi.mocked(updateConfig)
        .mockResolvedValueOnce({
          config: { model: {} },
          errors: [{ path: "data", message: "Field required" }],
          saved: false,
          // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
        } as any)
        .mockResolvedValueOnce({
          config: { model: { name: "Y" } },
          errors: [],
          saved: true,
          // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
        } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "X" } });
      });
      expect(result.current.errors.length).toBeGreaterThan(0);

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "Y" } });
      });
      expect(result.current.errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // P-0089 / Issue #279: PUT /config returns 409 WORKSPACE_LOCKED while a
  // fit/tune job is running. handleConfigChange must surface a quiet info
  // toast (not the generic error path) and re-fetch so the form resyncs to
  // the locked-in config. The cache must NOT be optimistically updated.
  // -------------------------------------------------------------------------
  describe("handleConfigChange — 409 WORKSPACE_LOCKED handling (#279)", () => {
    it("invalidates cache and does not push to history when 409 fires", async () => {
      // Lazy import inside the test to avoid hoisting weirdness with the
      // top-level vi.mock("@/api/workspace") block.
      const { ApiError } = await import("@/api/client");
      vi.mocked(updateConfig).mockRejectedValueOnce(
        new ApiError(409, {
          error: {
            code: "WORKSPACE_LOCKED",
            message: "Config is locked while job xyz is running",
            details: { job_id: "xyz" },
          },
        }),
      );

      const { wrapper, queryClient } = makeWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      const undoBefore = result.current.history.canUndo;

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "Z" } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.config(),
      });
      // Rejected write must not land on history.
      expect(result.current.history.canUndo).toBe(undoBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Issue #276: handleLoadPreset must merge preset with current data so the
  // backend `data` field (which presets intentionally omit) is preserved.
  // -------------------------------------------------------------------------
  describe("handleLoadPreset — merges preset with current data (#276)", () => {
    afterEach(() => {
      localStorage.clear();
    });

    it("preserves data.path / data.target from current config when applying a preset", async () => {
      // Pre-populate localStorage with a data-stripped preset (this is
      // what useConfigPresets.save would have written — sanitizeConfig
      // strips the `data` and `features` keys before serialising).
      // useConfigPresets reads from localStorage at hook-init time, so
      // the preset must exist BEFORE the hook mounts.
      localStorage.setItem(
        "lizystudio-config-presets",
        JSON.stringify([
          {
            name: "p1",
            config: {
              config_version: 1,
              task: "binary",
              split: { method: "stratified_kfold", n_splits: 5 },
              model: { name: "lgbm", params: {} },
            },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      );

      vi.mocked(fetchConfig).mockResolvedValueOnce({
        config_version: 1,
        task: "binary",
        data: {
          path: "/tmp/train.csv",
          target: "Survived",
          time_col: null,
          group_col: null,
        },
        split: { method: "kfold", n_splits: 3 },
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any);

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        result.current.handleLoadPreset("p1");
        // wait for the async handleConfigChange chain
        await new Promise((r) => setTimeout(r, 10));
      });

      // updateConfig must have received a body that includes the current
      // data field (merged from the cached config), not undefined.
      const lastCall = vi.mocked(updateConfig).mock.calls.at(-1)?.[0];
      expect(lastCall).toBeDefined();
      expect((lastCall as Record<string, unknown>).data).toEqual({
        path: "/tmp/train.csv",
        target: "Survived",
        time_col: null,
        group_col: null,
      });
      // And the preset's split.method is what gets sent (not the prior
      // config's split.method).
      expect((lastCall as Record<string, unknown>).split).toEqual({
        method: "stratified_kfold",
        n_splits: 5,
      });
    });
  });

  // -------------------------------------------------------------------------
  // handleImport
  // -------------------------------------------------------------------------
  it("handleImport posts the file and invalidates config cache on success", async () => {
    vi.mocked(uploadConfig).mockResolvedValueOnce({
      errors: [],
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);
    const { wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.config).toBeDefined());

    const file = new File(["config: {}"], "c.yaml", { type: "text/yaml" });
    await act(async () => {
      await result.current.handleImport(file);
    });

    expect(uploadConfig).toHaveBeenCalledWith(file);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.config(),
    });
  });

  it("handleImport surfaces errors from the server response", async () => {
    vi.mocked(uploadConfig).mockResolvedValueOnce({
      errors: [{ path: "model", message: "required" }],
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.config).toBeDefined());

    const file = new File(["bad"], "c.yaml", { type: "text/yaml" });
    await act(async () => {
      await result.current.handleImport(file);
    });

    expect(result.current.errors).toEqual([
      { path: "model", message: "required" },
    ]);
  });
});
