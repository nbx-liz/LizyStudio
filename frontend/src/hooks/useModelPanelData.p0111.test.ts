/**
 * P-0111: `handleConfigPatch`, the Tune tab's routed write path.
 *
 * It keeps `handleConfigChange`'s guarantees (P-0110): a refused write is
 * never reported as saved, never enters the undo history, and never leaves
 * the cache holding something the backend did not store.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { createControllableFunnel } from "@/test/fakeFunnel";
import { validationProblem } from "@/test/problemDetails";
import type { WriteOp } from "./useConfigWriteFunnel";
import { useModelPanelData } from "./useModelPanelData";

vi.mock("@/api/workspace", () => ({
  fetchBackends: vi.fn().mockResolvedValue([]),
  fetchColumns: vi.fn().mockResolvedValue({ columns: [] }),
  fetchConfig: vi.fn().mockResolvedValue({}),
  fetchConfigSchema: vi.fn().mockResolvedValue({ type: "object" }),
  fetchUiSchema: vi.fn().mockResolvedValue({}),
  getConfigDownloadUrl: vi.fn().mockReturnValue("/api/config/download"),
  updateConfig: vi
    .fn()
    .mockResolvedValue({ config: {}, validation_errors: [] }),
  updateTuningOverrides: vi.fn().mockResolvedValue({ tuning_effective: {} }),
  uploadConfig: vi.fn().mockResolvedValue({ validation_errors: [] }),
  validateConfig: vi.fn().mockResolvedValue({ errors: [] }),
}));

import {
  fetchConfig,
  updateConfig,
  updateTuningOverrides,
} from "@/api/workspace";

const CACHED = {
  task: "binary",
  model: { params: { num_leaves: 31 } },
  tuning: {
    optuna: { params: { n_trials: 20 } },
    evaluation: { metrics: ["auc"] },
  },
};

const N_TRIALS_PATCH = [
  { path: ["tuning", "optuna", "params"], value: { n_trials: 80 } },
] as const;

function setup(
  respond?: Parameters<typeof createControllableFunnel>[0],
  options: { running?: boolean; withFunnel?: boolean } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  queryClient.setQueryData(queryKeys.config(), CACHED);
  // `useConfig` may refetch on mount; it must read back the same config.
  vi.mocked(fetchConfig).mockResolvedValue(CACHED);
  const fake = createControllableFunnel(respond);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(
    () =>
      useModelPanelData({
        hasData: true,
        running: options.running ?? false,
        writeFunnel: options.withFunnel === false ? null : fake.funnel,
      }),
    { wrapper },
  );
  return { result, queryClient, ...fake };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useModelPanelData.handleConfigPatch (P-0111)", () => {
  it("enqueues the patches as ONE patch-many op on the given reason and records the saved config", async () => {
    const saved = {
      ...CACHED,
      tuning: { ...CACHED.tuning, optuna: { params: { n_trials: 80 } } },
    };
    const later = { ...saved, model: { params: { num_leaves: 63 } } };
    const responses = [saved, later];
    const { result, enqueueWrite } = setup(() => ({
      ok: true,
      saved: { config: responses.shift() ?? later },
    }));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleConfigPatch(
        N_TRIALS_PATCH,
        "tuning_overrides",
      );
    });

    expect(ok).toBe(true);
    expect(enqueueWrite).toHaveBeenCalledTimes(1);
    const op = enqueueWrite.mock.calls[0][0] as WriteOp;
    expect(op).toEqual({
      kind: "patch-many",
      patches: N_TRIALS_PATCH,
      reason: "tuning_overrides",
    });
    // The saved config entered the history: a second save makes it the
    // state an undo returns to.
    await act(async () => {
      await result.current.handleConfigPatch(
        [{ path: ["model", "params", "num_leaves"], value: 63 }],
        "legacy_config",
      );
    });
    expect(result.current.history.peekUndo()).toEqual(saved);
  });

  it("sends nothing when the patch leaves the cached config unchanged", async () => {
    const { result, enqueueWrite } = setup();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleConfigPatch(
        [{ path: ["model", "params", "num_leaves"], value: 31 }],
        "legacy_config",
      );
    });
    expect(ok).toBe(true);
    expect(enqueueWrite).not.toHaveBeenCalled();
  });

  it("sends nothing while a job runs", async () => {
    const { result, enqueueWrite } = setup(undefined, { running: true });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleConfigPatch(
        N_TRIALS_PATCH,
        "tuning_overrides",
      );
    });
    expect(ok).toBe(false);
    expect(enqueueWrite).not.toHaveBeenCalled();
  });

  it("a refused write (422) is not saved: no history, cache untouched, config re-fetched", async () => {
    const { toast } = await import("sonner");
    const errorSpy = vi.spyOn(toast, "error");
    const { result, queryClient } = setup(() => ({
      ok: false,
      error: "rejected",
      details: validationProblem(),
    }));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleConfigPatch(
        N_TRIALS_PATCH,
        "tuning_overrides",
      );
    });

    expect(ok).toBe(false);
    expect(result.current.history.canUndo).toBe(false);
    expect(queryClient.getQueryData(queryKeys.config())).toBe(CACHED);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.config() });
  });

  it("a write that failed in transit re-fetches the config instead of keeping a guess", async () => {
    const { result, queryClient } = setup(() => ({
      ok: false,
      error: "network",
      details: new Error("down"),
    }));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleConfigPatch(
        N_TRIALS_PATCH,
        "tuning_overrides",
      );
    });

    expect(ok).toBe(false);
    expect(result.current.history.canUndo).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.config() });
  });

  it("without a funnel, a tuning_overrides write goes to the overrides endpoint only", async () => {
    const { result, queryClient } = setup(undefined, { withFunnel: false });
    // Let the mount-time config read settle before the write.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await result.current.handleConfigPatch(
        N_TRIALS_PATCH,
        "tuning_overrides",
      );
    });
    expect(updateConfig).not.toHaveBeenCalled();
    expect(updateTuningOverrides).toHaveBeenCalledTimes(1);
    expect(updateTuningOverrides).toHaveBeenCalledWith({
      n_trials: 80,
      evaluation_metrics: ["auc"],
    });
    const cachedAfter = queryClient.getQueryData<{
      tuning: { optuna: { params: unknown } };
    }>(queryKeys.config());
    expect(cachedAfter?.tuning.optuna.params).toEqual({ n_trials: 80 });
  });

  it("without a funnel, a legacy_config write goes to PUT /config only", async () => {
    const { result } = setup(undefined, { withFunnel: false });
    await act(async () => {
      await result.current.handleConfigPatch(
        [{ path: ["model", "params", "num_leaves"], value: 63 }],
        "legacy_config",
      );
    });
    expect(updateTuningOverrides).not.toHaveBeenCalled();
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });
});
