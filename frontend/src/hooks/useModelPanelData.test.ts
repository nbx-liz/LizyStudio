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
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  updateConfig: vi.fn().mockResolvedValue(undefined),
  uploadConfig: vi.fn().mockResolvedValue({ errors: [] }),
  validateConfig: vi.fn().mockResolvedValue({ errors: [] }),
}));

import {
  fetchColumns,
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
