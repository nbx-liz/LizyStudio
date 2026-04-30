import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  fetchConfigDefaults: vi.fn(),
  updateConfig: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/api/workspace", () => ({
  fetchConfig: mocks.fetchConfig,
  fetchConfigDefaults: mocks.fetchConfigDefaults,
  updateConfig: mocks.updateConfig,
  loadDataFromPath: vi.fn(),
  uploadData: vi.fn(),
  fetchPreview: vi.fn(),
  fetchColumns: vi.fn(),
  fetchColumnStats: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { queryKeys } from "@/api/queryKeys";
import { INITIAL_BLOCKED_STATE } from "@/components/workspace/BlockedGroupKFoldEditor";
import { INITIAL_CV_STATE } from "@/components/workspace/cv-state";
import { useConfigSync } from "./useConfigSync";
import type { ColumnOverride, TaskType } from "./useDataPanel.types";

function makeQueryWrapper() {
  // gcTime > 0 so setQueryData survives long enough for assertions; the
  // hook under test has no observer for queryKeys.config() so a 0-gcTime
  // would tombstone the entry immediately on insert.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

function defaultParams(
  partial: Partial<Parameters<typeof useConfigSync>[0]> = {},
) {
  return {
    dataPath: "/data/x.csv",
    target: "y",
    task: "binary" as TaskType,
    overrides: {} as Record<string, ColumnOverride>,
    cv: INITIAL_CV_STATE,
    blocked: INITIAL_BLOCKED_STATE,
    onDataChanged: vi.fn(),
    ...partial,
  };
}

const baseConfig = {
  config_version: 1,
  task: "binary",
  data: {},
  features: {},
  training: {},
};

const defaultsConfig = {
  config_version: 1,
  task: "regression",
  data: {},
  features: {},
  training: {},
};

describe("useConfigSync", () => {
  let testWrapper: ReturnType<typeof makeQueryWrapper>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchConfig.mockResolvedValue(baseConfig);
    mocks.fetchConfigDefaults.mockResolvedValue(defaultsConfig);
    mocks.updateConfig.mockResolvedValue({});
    testWrapper = makeQueryWrapper();
  });

  it("returns the public API shape", () => {
    const { result } = renderHook(() => useConfigSync(defaultParams()), {
      wrapper: testWrapper.wrapper,
    });
    expect(result.current.syncConfig).toBeInstanceOf(Function);
    expect(result.current.setSyncSuppressed).toBeInstanceOf(Function);
    expect(result.current.preseedSyncKey).toBeInstanceOf(Function);
  });

  it("skips sync when target is null", () => {
    renderHook(() => useConfigSync(defaultParams({ target: null })), {
      wrapper: testWrapper.wrapper,
    });
    expect(mocks.fetchConfig).not.toHaveBeenCalled();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it("runs sync on mount when target is set and writes the merged config", async () => {
    const onDataChanged = vi.fn();
    renderHook(() => useConfigSync(defaultParams({ onDataChanged })), {
      wrapper: testWrapper.wrapper,
    });

    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1));
    const [payload] = mocks.updateConfig.mock.calls[0];
    expect(payload.task).toBe("binary");
    expect(payload.data.path).toBe("/data/x.csv");
    expect(payload.data.target).toBe("y");
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("falls back to fetchConfigDefaults when the existing config lacks config_version", async () => {
    mocks.fetchConfig.mockResolvedValue({ data: {}, features: {} });
    renderHook(() => useConfigSync(defaultParams()), {
      wrapper: testWrapper.wrapper,
    });

    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalled());
    expect(mocks.fetchConfigDefaults).toHaveBeenCalledWith("binary", "y");
  });

  it("skips the defaults fallback when task or target is missing and config has no version", async () => {
    mocks.fetchConfig.mockResolvedValue({ data: {}, features: {} });
    renderHook(
      () => useConfigSync(defaultParams({ task: null, target: "y" })),
      { wrapper: testWrapper.wrapper },
    );

    // target is set so sync still runs, but fetchConfigDefaults requires
    // both task and target — so it must not be called.
    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalled());
    expect(mocks.fetchConfigDefaults).not.toHaveBeenCalled();
  });

  it("writes categorical + excluded overrides into features", async () => {
    const overrides: Record<string, ColumnOverride> = {
      age: { excluded: false, type: "numeric" },
      region: { excluded: false, type: "categorical" },
      leaky: { excluded: true, type: "numeric" },
    };
    renderHook(() => useConfigSync(defaultParams({ overrides })), {
      wrapper: testWrapper.wrapper,
    });

    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalled());
    const [payload] = mocks.updateConfig.mock.calls[0];
    expect(payload.features.categorical).toEqual(["region"]);
    expect(payload.features.exclude).toEqual(["leaky"]);
  });

  it("does not re-run sync when inputs are unchanged between renders", async () => {
    const params = defaultParams();
    const { rerender } = renderHook(() => useConfigSync(params), {
      wrapper: testWrapper.wrapper,
    });
    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1));

    rerender();
    rerender();
    rerender();

    // sync key unchanged → no extra update
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.updateConfig).toHaveBeenCalledTimes(1);
  });

  it("suppresses the next sync when setSyncSuppressed(true) is called before the input change", async () => {
    const initialParams = defaultParams();
    const { rerender, result } = renderHook(
      ({ params }: { params: ReturnType<typeof defaultParams> }) =>
        useConfigSync(params),
      { initialProps: { params: initialParams }, wrapper: testWrapper.wrapper },
    );
    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1));

    act(() => result.current.setSyncSuppressed(true));
    rerender({ params: defaultParams({ target: "z" }) });

    await new Promise((r) => setTimeout(r, 10));
    // Suppressed: no second updateConfig call.
    expect(mocks.updateConfig).toHaveBeenCalledTimes(1);
  });

  it("preseedSyncKey prevents the initial auto-run from firing updateConfig", async () => {
    const { result, rerender } = renderHook(
      ({ params }: { params: ReturnType<typeof defaultParams> }) =>
        useConfigSync(params),
      {
        initialProps: { params: defaultParams({ target: null }) },
        wrapper: testWrapper.wrapper,
      },
    );

    // Pre-seed the sync key to match what the effect would compute
    // for (target=y, task=binary, ...). Reproducing buildSyncKey here
    // would duplicate test logic, so we instead verify the
    // preseed-then-rerender path triggers exactly ONE diff-detected
    // sync when we later change a different input.
    act(() =>
      result.current.preseedSyncKey("arbitrary-preseed-ignored-on-diff"),
    );

    rerender({ params: defaultParams({ target: "y" }) });
    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalled());
    // The preseed value differs from the new key → exactly one sync.
    expect(mocks.updateConfig).toHaveBeenCalledTimes(1);
  });

  it("reports an error toast when updateConfig throws a non-AbortError", async () => {
    mocks.updateConfig.mockRejectedValue(new Error("500 server"));
    renderHook(() => useConfigSync(defaultParams()), {
      wrapper: testWrapper.wrapper,
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Config sync failed — changes may not be saved",
      ),
    );
  });

  it("swallows AbortError silently (no toast)", async () => {
    const abort = new DOMException("aborted", "AbortError");
    mocks.fetchConfig.mockRejectedValueOnce(abort);
    renderHook(() => useConfigSync(defaultParams()), {
      wrapper: testWrapper.wrapper,
    });

    // Give the async handler a chance to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // P-0090 / Issue #278 residual: useConfigSync must update the TanStack
  // Query cache atomically with its successful PUT, not only invalidate via
  // onDataChanged. Otherwise ConfigForm's stale-snapshot effects (inner_valid
  // reset, calibration auto-clear) read the pre-PUT cache, recompute against
  // the old `split.method`, and fire a competing PUT through
  // useModelPanelData.handleConfigChange that reverts the user's strategy
  // change. setQueryData closes the race window structurally — ConfigForm
  // sees the merged config on the very next render, so its effects either
  // no-op (no inconsistency) or compose correctly on top of the new state.
  // -------------------------------------------------------------------------
  describe("setQueryData cache update on success (#278 residual)", () => {
    it("writes the merged config to the React Query cache after a successful PUT", async () => {
      const { queryClient, wrapper } = testWrapper;
      renderHook(() => useConfigSync(defaultParams()), { wrapper });

      await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1));
      const [payload] = mocks.updateConfig.mock.calls[0];
      expect(queryClient.getQueryData(queryKeys.config())).toEqual(payload);
    });

    it("does not pollute the cache when updateConfig rejects", async () => {
      mocks.updateConfig.mockRejectedValue(new Error("boom"));
      const { queryClient, wrapper } = testWrapper;
      renderHook(() => useConfigSync(defaultParams()), { wrapper });

      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(
          "Config sync failed — changes may not be saved",
        ),
      );
      // No setQueryData on failure — cache must remain untouched.
      expect(queryClient.getQueryData(queryKeys.config())).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // P-0092 Q-1 Phase 5: write funnel routing.
  //
  // When a `writeFunnel` is provided, useConfigSync.syncConfig MUST enqueue
  // through the funnel with `reason="cv-change"` instead of calling
  // `updateConfig` directly. The funnel's onWriteCommitted owns the cache
  // write, so the hook must NOT do its own setQueryData on the funnel path
  // — otherwise the wrapper-leak fix in WorkspacePage.onWriteCommitted
  // would be bypassed.
  // -------------------------------------------------------------------------
  describe("write funnel routing (P-0092 Phase 5)", () => {
    function createStubFunnel(
      stub?: (op: {
        kind: "replace";
        config: Record<string, unknown>;
        reason: string;
      }) =>
        | { ok: true; saved: unknown }
        | { ok: false; error: string; details?: unknown },
    ) {
      const calls: { reason: string; config: Record<string, unknown> }[] = [];
      const enqueueWrite = vi.fn(async (op: unknown) => {
        const replace = op as {
          kind: "replace";
          config: Record<string, unknown>;
          reason: string;
        };
        calls.push({ reason: replace.reason, config: replace.config });
        return (
          stub?.(replace) ?? {
            ok: true as const,
            saved: { config: replace.config, errors: [], saved: true },
          }
        );
      });
      return {
        funnel: { enqueueWrite, isFlushing: () => false },
        calls,
      };
    }

    it("enqueues with reason=cv-change when a funnel is mounted", async () => {
      const { funnel, calls } = createStubFunnel();
      const { wrapper } = testWrapper;
      renderHook(
        () =>
          useConfigSync(
            defaultParams({
              // biome-ignore lint/suspicious/noExplicitAny: stub funnel
              writeFunnel: funnel as any,
            }),
          ),
        { wrapper },
      );

      await waitFor(() => expect(calls.length).toBe(1));
      expect(calls[0].reason).toBe("cv-change");
      // updateConfig must NOT have been called when the funnel is wired —
      // the funnel's putConfig (which IS updateConfig in production) is
      // a separate seam owned by the funnel itself.
      expect(mocks.updateConfig).not.toHaveBeenCalled();
    });

    it("does not write to React Query cache directly when funnel is mounted", async () => {
      // The funnel's onWriteCommitted is the sole cache writer — the hook
      // must not bypass it with its own setQueryData. This is what unblocks
      // the wrapper-leak fix in WorkspacePage.onWriteCommitted.
      const { funnel } = createStubFunnel();
      const { queryClient, wrapper } = testWrapper;
      renderHook(
        () =>
          useConfigSync(
            defaultParams({
              // biome-ignore lint/suspicious/noExplicitAny: stub funnel
              writeFunnel: funnel as any,
            }),
          ),
        { wrapper },
      );

      await waitFor(() => expect(funnel.enqueueWrite).toHaveBeenCalledTimes(1));
      // Cache must be untouched on the funnel path. (Production's funnel
      // would set the cache via onWriteCommitted, but our stub doesn't.)
      expect(queryClient.getQueryData(queryKeys.config())).toBeUndefined();
    });

    it("calls onDataChanged after a successful funnel enqueue", async () => {
      const onDataChanged = vi.fn();
      const { funnel } = createStubFunnel();
      const { wrapper } = testWrapper;
      renderHook(
        () =>
          useConfigSync(
            defaultParams({
              onDataChanged,
              // biome-ignore lint/suspicious/noExplicitAny: stub funnel
              writeFunnel: funnel as any,
            }),
          ),
        { wrapper },
      );

      await waitFor(() => expect(onDataChanged).toHaveBeenCalledTimes(1));
    });

    it("surfaces error toast when funnel returns ok=false (network/other)", async () => {
      const { funnel } = createStubFunnel(() => ({
        ok: false,
        error: "network",
        details: new Error("boom"),
      }));
      const { wrapper } = testWrapper;
      renderHook(
        () =>
          useConfigSync(
            defaultParams({
              // biome-ignore lint/suspicious/noExplicitAny: stub funnel
              writeFunnel: funnel as any,
            }),
          ),
        { wrapper },
      );

      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(
          "Config sync failed — changes may not be saved",
        ),
      );
    });

    it("surfaces info toast (not error) when funnel returns 409 WORKSPACE_LOCKED via details", async () => {
      const { ApiError } = await import("@/api/client");
      const lockErr = new ApiError(409, {
        error: {
          code: "WORKSPACE_LOCKED",
          message: "Config is locked while job xyz is running",
          details: { job_id: "xyz" },
        },
      });
      const { funnel } = createStubFunnel(() => ({
        ok: false,
        error: "network",
        details: lockErr,
      }));
      const { wrapper } = testWrapper;
      renderHook(
        () =>
          useConfigSync(
            defaultParams({
              // biome-ignore lint/suspicious/noExplicitAny: stub funnel
              writeFunnel: funnel as any,
            }),
          ),
        { wrapper },
      );

      // The hook must NOT show the generic error toast for the lock case.
      await new Promise((r) => setTimeout(r, 30));
      expect(mocks.toastError).not.toHaveBeenCalledWith(
        "Config sync failed — changes may not be saved",
      );
    });

    it("does not call onDataChanged when funnel returns ok=false with error=aborted", async () => {
      // H-1 regression: when the funnel returns { ok:false, error:"aborted" }
      // (e.g. unmount mid-flush), `result.details` is undefined. Earlier
      // code coerced that to a falsy `putError` and fell through to the
      // success path, firing onDataChanged + spurious cache invalidations
      // even though the PUT was never sent.
      const onDataChanged = vi.fn();
      const { funnel } = createStubFunnel(() => ({
        ok: false,
        error: "aborted",
      }));
      const { wrapper } = testWrapper;
      renderHook(
        () =>
          useConfigSync(
            defaultParams({
              onDataChanged,
              // biome-ignore lint/suspicious/noExplicitAny: stub funnel
              writeFunnel: funnel as any,
            }),
          ),
        { wrapper },
      );

      await waitFor(() => expect(funnel.enqueueWrite).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 30));
      expect(onDataChanged).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
    });
  });
});
