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
import { createControllableFunnel } from "@/test/fakeFunnel";
import {
  asServedEntry,
  N_SPLITS_ERROR,
  validationProblem,
  workspaceLockedProblem,
} from "@/test/problemDetails";
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
  // PUT /config returns { config, validation_errors } per
  // ConfigUpdateResponse on a 200, and throws a 422 ApiError when it
  // refuses the body (P-0110). Default mock simulates a successful save.
  updateConfig: vi
    .fn()
    .mockResolvedValue({ config: {}, validation_errors: [] }),
  uploadConfig: vi.fn().mockResolvedValue({ validation_errors: [] }),
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

  // -------------------------------------------------------------------------
  // Issue #277 / P-0091: nonExcludedColumns must NOT contain the target
  // column or any column the user explicitly excluded via Column Settings.
  // FeatureWeightsEditor consumes this list — if target / excluded columns
  // leak in, the user can attach a weight to the prediction target or to a
  // feature the backend ignores, both of which the backend either rejects
  // at fit-time or silently drops.
  // -------------------------------------------------------------------------
  describe("nonExcludedColumns filters target + features.exclude (#277)", () => {
    it("filters target out when config.data.target is set", async () => {
      vi.mocked(fetchColumns).mockResolvedValueOnce({
        columns: [
          { name: "Pclass", suggested_excluded: false },
          { name: "Survived", suggested_excluded: false },
          { name: "Age", suggested_excluded: false },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any);
      vi.mocked(fetchConfig).mockResolvedValueOnce({
        config_version: 1,
        task: "binary",
        data: { target: "Survived" },
        features: { exclude: [], categorical: [] },
        model: {},
      });

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.nonExcludedColumns).toEqual(["Pclass", "Age"]);
      });
    });

    it("filters columns listed in config.features.exclude", async () => {
      vi.mocked(fetchColumns).mockResolvedValueOnce({
        columns: [
          { name: "Pclass", suggested_excluded: false },
          { name: "Ticket", suggested_excluded: false },
          { name: "Cabin", suggested_excluded: false },
          { name: "Age", suggested_excluded: false },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any);
      vi.mocked(fetchConfig).mockResolvedValueOnce({
        config_version: 1,
        task: "binary",
        data: { target: "Survived" },
        features: { exclude: ["Ticket", "Cabin"], categorical: [] },
        model: {},
      });

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.nonExcludedColumns).toEqual(["Pclass", "Age"]);
      });
    });

    it("falls back to suggested_excluded only when config is not yet seeded", async () => {
      vi.mocked(fetchColumns).mockResolvedValueOnce({
        columns: [
          { name: "a", suggested_excluded: false },
          { name: "b", suggested_excluded: true },
          { name: "c", suggested_excluded: false },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any);
      // No config_version / data.target — pre-seeding state.
      vi.mocked(fetchConfig).mockResolvedValueOnce({
        model: {},
      });

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.nonExcludedColumns).toEqual(["a", "c"]);
      });
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

  // PR-C2 / Issue #394: warnings advise but do not block Fit. Only
  // severity="error" entries (or pre-PR-B4 entries with no severity)
  // disable the Fit button. Warnings reach the hook's ``errors`` state
  // through the debounced validateConfig call after a successful save.
  it("fitEnabled stays true when only severity=warning entries are present", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(validateConfig).mockResolvedValueOnce({
      errors: [
        {
          path: "evaluation.metrics",
          message: "MAPE undefined when target contains zeros.",
          severity: "warning",
          suggested_fix: "Remove 'mape' from evaluation.metrics.",
        },
      ],
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.errors).toHaveLength(1);
    expect(result.current.errors[0]?.severity).toBe("warning");
    expect(result.current.fitEnabled).toBe(true);
    expect(result.current.disabledReason).toBeNull();
    vi.useRealTimers();
  });

  it("fitEnabled is false when at least one severity=error entry is present", async () => {
    vi.mocked(updateConfig).mockRejectedValueOnce(
      validationProblem([
        N_SPLITS_ERROR,
        {
          path: "evaluation.metrics",
          message: "MAPE undefined when target contains zeros.",
          severity: "warning",
          suggested_fix: "Remove 'mape' from evaluation.metrics.",
        },
      ]),
    );

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.config).toBeDefined());
    await act(async () => {
      await result.current.handleConfigChange({ model: { name: "X" } });
    });

    expect(result.current.fitEnabled).toBe(false);
    expect(result.current.disabledReason).toBe("Fix validation errors first");
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
  // Issue #276 + P-0110: handleConfigChange must observe the 422 Problem
  // Details rejection from the backend and not silently swallow it.
  //
  // Invariants under test:
  //   INV-A1: when updateConfig throws the 422, the cached query data
  //           is NOT updated (frontend stays consistent with backend).
  //   INV-A2: when updateConfig throws the 422, its validation_errors
  //           surface on the hook's `errors` state and in one toast.
  //   INV-A3: when updateConfig throws the 422, the change is NOT
  //           pushed to history (undo/redo would otherwise re-apply the
  //           unsaved config).
  // -------------------------------------------------------------------------
  describe("handleConfigChange — 422 rejection observation (#276, P-0110)", () => {
    it("does not write to cache when backend answers 422", async () => {
      vi.mocked(updateConfig).mockRejectedValueOnce(
        validationProblem([{ path: "data", message: "Field required" }]),
      );

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

    it("surfaces backend errors on the errors state and in one toast when 422", async () => {
      const { toast } = await import("sonner");
      const errorSpy = vi.spyOn(toast, "error");
      const rejectionErrors = [
        { path: "data", message: "Field required" },
        { path: "split.method", message: "Invalid value" },
      ];
      vi.mocked(updateConfig).mockRejectedValueOnce(
        validationProblem(rejectionErrors),
      );

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "X" } });
      });

      expect(result.current.errors).toEqual(rejectionErrors.map(asServedEntry));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("Config not saved: Field required");
      errorSpy.mockRestore();
    });

    it("does not push rejected config onto history (undo would otherwise re-apply it)", async () => {
      vi.mocked(updateConfig)
        .mockResolvedValueOnce({ config: {}, validation_errors: [] })
        .mockRejectedValueOnce(
          validationProblem([{ path: "data", message: "Field required" }]),
        )
        .mockResolvedValueOnce({ config: {}, validation_errors: [] });

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "A" } });
      });
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "X" } });
      });
      // Only A is recorded: had X been pushed, A would be undoable.
      expect(result.current.history.peekUndo()).toBeNull();
      expect(result.current.history.canUndo).toBe(false);

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "B" } });
      });
      // The undo target after B is A, never the refused X.
      expect(result.current.history.peekUndo()).toEqual({
        model: { name: "A" },
      });
      expect(updateConfig).toHaveBeenCalledTimes(3);
    });

    it("clears errors when a subsequent successful change comes through", async () => {
      vi.mocked(updateConfig)
        .mockRejectedValueOnce(
          validationProblem([{ path: "data", message: "Field required" }]),
        )
        .mockResolvedValueOnce({
          config: { model: { name: "Y" } },
          validation_errors: [],
        });

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
      vi.mocked(updateConfig).mockRejectedValueOnce(
        workspaceLockedProblem("xyz"),
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
      // Post-#339 budget assertion — exactly one invalidate from the 409
      // catch path. A future cascade adding a second invalidate (e.g.
      // an extra ``invalidateQueries(jobs())`` to refresh the lock owner
      // job list) would fail this guard before it could ship.
      expect(invalidateSpy).toHaveBeenCalledTimes(1);
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
      config: {},
      validation_errors: [],
    });
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

    expect(uploadConfig).toHaveBeenCalledTimes(1);
    expect(uploadConfig).toHaveBeenCalledWith(file);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.config(),
    });
    // Post-#339 budget assertion — single invalidate of config().
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("handleImport surfaces warnings from a 200 response", async () => {
    const warning = {
      path: "evaluation.metrics",
      message: "MAPE undefined",
      severity: "warning" as const,
    };
    vi.mocked(uploadConfig).mockResolvedValueOnce({
      config: {},
      validation_errors: [warning],
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useModelPanelData({ hasData: true, running: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.config).toBeDefined());

    const file = new File(["ok"], "c.yaml", { type: "text/yaml" });
    await act(async () => {
      await result.current.handleImport(file);
    });

    expect(result.current.errors).toEqual([warning]);
  });

  // P-0110: an imported config that fails validation is a 422. Before, the
  // 200 + saved=false answer still showed "Config imported".
  it("handleImport surfaces a 422 rejection as an error, not success", async () => {
    const { toast } = await import("sonner");
    const errorSpy = vi.spyOn(toast, "error");
    const successSpy = vi.spyOn(toast, "success");
    vi.mocked(uploadConfig).mockRejectedValueOnce(
      validationProblem([{ path: "model", message: "required" }]),
    );
    const { wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
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
      asServedEntry({ path: "model", message: "required" }),
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Import failed: required");
    expect(successSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    successSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Owner ruling (PR #781 round 2): undo, redo and preset load are disabled
  // while a config write is queued or in flight, and their handlers return
  // early if called then, so no other write can interleave between their
  // snapshot read and their commit / rollback.
  // -------------------------------------------------------------------------
  describe("undo / redo / preset load while a write is pending (P-0110)", () => {
    it("reports writePending and makes the three handlers no-ops", async () => {
      const { toast } = await import("sonner");
      const successSpy = vi.spyOn(toast, "success");
      const infoSpy = vi.spyOn(toast, "info");
      const errorSpy = vi.spyOn(toast, "error");
      localStorage.setItem(
        "lizystudio-config-presets",
        JSON.stringify([
          {
            name: "p1",
            config: { model: { name: "P" } },
            createdAt: "2026-01-01",
          },
        ]),
      );
      const { funnel, enqueueWrite, setBusy } = createControllableFunnel();
      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useModelPanelData({
            hasData: true,
            running: false,
            writeFunnel: funnel,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "A" } });
      });
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "B" } });
      });
      await act(async () => {
        await result.current.handleUndo();
      });
      // A is current, B is redoable, and nothing is undoable.
      expect(enqueueWrite).toHaveBeenCalledTimes(3);
      expect(result.current.writePending).toBe(false);
      successSpy.mockClear();
      infoSpy.mockClear();

      setBusy(true);
      expect(result.current.writePending).toBe(true);
      await act(async () => {
        await result.current.handleRedo();
        await result.current.handleUndo();
        await result.current.handleLoadPreset("p1");
      });

      // No PUT, no cursor move, no toast.
      expect(enqueueWrite).toHaveBeenCalledTimes(3);
      expect(result.current.history.peekRedo()).toEqual({
        model: { name: "B" },
      });
      expect(successSpy).toHaveBeenCalledTimes(0);
      expect(infoSpy).toHaveBeenCalledTimes(0);
      expect(errorSpy).toHaveBeenCalledTimes(0);

      // Once the write settles, redo works again (the committed path).
      setBusy(false);
      expect(result.current.writePending).toBe(false);
      await act(async () => {
        await result.current.handleRedo();
      });
      expect(enqueueWrite).toHaveBeenCalledTimes(4);
      expect(result.current.history.peekUndo()).toEqual({
        model: { name: "A" },
      });
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith("Config redone");

      localStorage.removeItem("lizystudio-config-presets");
      successSpy.mockRestore();
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // P-0110: undo / redo move the history cursor only after the backend
  // accepted the PUT. A refused write leaves the cursor where it was, so it
  // never sits on a snapshot the server does not hold.
  // -------------------------------------------------------------------------
  describe("undo / redo refused by the backend (P-0110)", () => {
    async function renderWithTwoEdits() {
      vi.mocked(updateConfig)
        .mockResolvedValueOnce({ config: {}, validation_errors: [] })
        .mockResolvedValueOnce({ config: {}, validation_errors: [] });
      const { wrapper, queryClient } = makeWrapper();
      const { result } = renderHook(
        () => useModelPanelData({ hasData: true, running: false }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "A" } });
      });
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "B" } });
      });
      return { result, queryClient };
    }

    it("a refused undo keeps the cursor and the cache on the current snapshot", async () => {
      const { toast } = await import("sonner");
      const errorSpy = vi.spyOn(toast, "error");
      const { result, queryClient } = await renderWithTwoEdits();
      vi.mocked(updateConfig).mockRejectedValueOnce(validationProblem());

      await act(async () => {
        await result.current.handleUndo();
      });

      expect(updateConfig).toHaveBeenCalledTimes(3);
      expect(vi.mocked(updateConfig).mock.calls[2][0]).toEqual({
        model: { name: "A" },
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        `Undo failed: ${N_SPLITS_ERROR.message}`,
      );
      expect(result.current.errors).toEqual([N_SPLITS_ERROR]);
      expect(result.current.history.peekUndo()).toEqual({
        model: { name: "A" },
      });
      expect(result.current.history.peekRedo()).toBeNull();
      expect(result.current.history.canRedo).toBe(false);
      expect(queryClient.getQueryData(queryKeys.config())).toEqual({
        model: { name: "B" },
      });
      errorSpy.mockRestore();
    });

    it("a refused redo keeps the cursor and the cache on the current snapshot", async () => {
      const { toast } = await import("sonner");
      const { result, queryClient } = await renderWithTwoEdits();
      vi.mocked(updateConfig).mockResolvedValueOnce({
        config: {},
        validation_errors: [],
      });
      await act(async () => {
        await result.current.handleUndo();
      });
      expect(result.current.history.peekRedo()).toEqual({
        model: { name: "B" },
      });

      const errorSpy = vi.spyOn(toast, "error");
      const infoSpy = vi.spyOn(toast, "info");
      vi.mocked(updateConfig).mockRejectedValueOnce(workspaceLockedProblem());
      await act(async () => {
        await result.current.handleRedo();
      });

      expect(updateConfig).toHaveBeenCalledTimes(4);
      expect(vi.mocked(updateConfig).mock.calls[3][0]).toEqual({
        model: { name: "B" },
      });
      expect(errorSpy).toHaveBeenCalledTimes(0);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(
        "Config is locked while a job is running",
      );
      infoSpy.mockRestore();
      // Cursor still on A: B stays the redo target, nothing is undoable.
      expect(result.current.history.peekRedo()).toEqual({
        model: { name: "B" },
      });
      expect(result.current.history.peekUndo()).toBeNull();
      expect(queryClient.getQueryData(queryKeys.config())).toEqual({
        model: { name: "A" },
      });
      errorSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // P-0092 Q-1 Phase 4: write funnel routing
  //
  // When a `writeFunnel` is provided (production: via context provider in
  // WorkspacePage; tests: via the params override), handleConfigChange /
  // handleUndo / handleRedo enqueue through the funnel instead of calling
  // updateConfig directly. The hook still owns the 422 / 409 /
  // debounce-validation observation logic — the funnel only owns the
  // network call ordering.
  // -------------------------------------------------------------------------
  describe("write funnel routing (P-0092 Phase 4)", () => {
    function createStubFunnel(
      stub: (op: {
        kind: "replace";
        config: Record<string, unknown>;
        reason: string;
      }) =>
        | {
            ok: true;
            saved: {
              config: Record<string, unknown>;
              validation_errors: [];
            };
          }
        | { ok: true; saved: unknown }
        | {
            ok: false;
            error: "network" | "rejected" | "locked";
            details?: unknown;
          },
    ) {
      const calls: { reason: string; config: Record<string, unknown> }[] = [];
      const enqueueWrite = vi.fn(async (op: unknown) => {
        const replace = op as {
          kind: "replace";
          config: Record<string, unknown>;
          reason: string;
        };
        calls.push({ reason: replace.reason, config: replace.config });
        return stub(replace);
      });
      return {
        funnel: { enqueueWrite, isFlushing: () => false },
        calls,
        enqueueWrite,
      };
    }

    it("handleConfigChange routes through funnel with reason=config-form-edit", async () => {
      const { funnel, calls } = createStubFunnel(() => ({
        ok: true,
        saved: { config: {}, validation_errors: [] },
      }));

      const { wrapper, queryClient } = makeWrapper();
      const { result } = renderHook(
        () =>
          useModelPanelData({
            hasData: true,
            running: false,
            // biome-ignore lint/suspicious/noExplicitAny: stub funnel for test
            writeFunnel: funnel as any,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "LGBM" } });
      });

      expect(calls).toEqual([
        { reason: "config-form-edit", config: { model: { name: "LGBM" } } },
      ]);
      // Direct updateConfig must NOT have been called when the funnel is wired.
      expect(updateConfig).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(queryKeys.config())).toEqual({
        model: { name: "LGBM" },
      });
    });

    it("handleConfigChange observes a 422 from the funnel result and surfaces errors", async () => {
      const rejectionErrors = [{ path: "data", message: "Field required" }];
      const { funnel } = createStubFunnel(() => ({
        ok: false,
        error: "rejected",
        details: validationProblem(rejectionErrors),
      }));

      const { wrapper, queryClient } = makeWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(
        () =>
          useModelPanelData({
            hasData: true,
            running: false,
            // biome-ignore lint/suspicious/noExplicitAny: stub funnel for test
            writeFunnel: funnel as any,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "X" } });
      });

      expect(result.current.errors).toEqual(rejectionErrors.map(asServedEntry));
      // Cache must NOT contain the rejected payload — invalidate forces re-fetch.
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.config(),
      });
      // Post-#339 budget assertion — single invalidate from the 422 path.
      expect(invalidateSpy).toHaveBeenCalledTimes(1);
      // Rejected change must not have been recorded in history.
      expect(result.current.history.canUndo).toBe(false);
    });

    it("handleConfigChange surfaces 409 WORKSPACE_LOCKED from funnel result.details", async () => {
      const { funnel } = createStubFunnel(() => ({
        ok: false,
        error: "locked",
        details: workspaceLockedProblem("xyz"),
      }));

      const { wrapper, queryClient } = makeWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(
        () =>
          useModelPanelData({
            hasData: true,
            running: false,
            // biome-ignore lint/suspicious/noExplicitAny: stub funnel for test
            writeFunnel: funnel as any,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "Z" } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.config(),
      });
      // Post-#339 budget assertion — single invalidate from funnel-410 path.
      expect(invalidateSpy).toHaveBeenCalledTimes(1);
      expect(result.current.history.canUndo).toBe(false);
    });

    it("handleUndo routes through funnel with reason=undo on success", async () => {
      const { funnel, calls } = createStubFunnel(() => ({
        ok: true,
        saved: { config: {}, validation_errors: [] },
      }));

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useModelPanelData({
            hasData: true,
            running: false,
            // biome-ignore lint/suspicious/noExplicitAny: stub funnel for test
            writeFunnel: funnel as any,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      // Seed history with two entries so undo has somewhere to go.
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "A" } });
      });
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "B" } });
      });
      expect(result.current.history.canUndo).toBe(true);

      await act(async () => {
        await result.current.handleUndo();
      });

      // H-3: the funnel path no longer writes to the cache locally —
      // production wires `onWriteCommitted` to apply the backend's
      // canonical (post-normalisation) snapshot, which the stub funnel
      // here does not simulate. Assert that the undo enqueued with
      // the right reason AND the right body (the prior history entry).
      const undoCall = calls.find((c) => c.reason === "undo");
      expect(undoCall).toBeDefined();
      expect(undoCall?.config).toEqual({ model: { name: "A" } });
    });

    it("handleRedo routes through funnel with reason=redo", async () => {
      const { funnel, calls } = createStubFunnel(() => ({
        ok: true,
        saved: { config: {}, validation_errors: [] },
      }));

      const { wrapper } = makeWrapper();
      const { result } = renderHook(
        () =>
          useModelPanelData({
            hasData: true,
            running: false,
            // biome-ignore lint/suspicious/noExplicitAny: stub funnel for test
            writeFunnel: funnel as any,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "A" } });
      });
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "B" } });
      });
      await act(async () => {
        await result.current.handleUndo();
      });
      await act(async () => {
        await result.current.handleRedo();
      });

      // H-3: same rationale as the undo test above. Assert the redo
      // enqueued with the right reason and the right history body.
      const redoCall = calls.find((c) => c.reason === "redo");
      expect(redoCall).toBeDefined();
      expect(redoCall?.config).toEqual({ model: { name: "B" } });
    });

    it("handleUndo surfaces 'Undo failed' toast when funnel returns ok=false", async () => {
      const { funnel } = createStubFunnel((op) => {
        if (op.reason === "undo") {
          return { ok: false, error: "network", details: new Error("boom") };
        }
        return {
          ok: true,
          saved: { config: {}, validation_errors: [] },
        };
      });

      const { wrapper, queryClient } = makeWrapper();
      const { result } = renderHook(
        () =>
          useModelPanelData({
            hasData: true,
            running: false,
            // biome-ignore lint/suspicious/noExplicitAny: stub funnel for test
            writeFunnel: funnel as any,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.config).toBeDefined());

      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "A" } });
      });
      await act(async () => {
        await result.current.handleConfigChange({ model: { name: "B" } });
      });
      const beforeUndo = queryClient.getQueryData(queryKeys.config());

      await act(async () => {
        await result.current.handleUndo();
      });

      // Cache must not have been updated to the undone state on failure.
      expect(queryClient.getQueryData(queryKeys.config())).toEqual(beforeUndo);
    });
  });
});
