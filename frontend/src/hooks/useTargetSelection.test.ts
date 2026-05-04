/**
 * Unit tests for useTargetSelection — the target-column mutation hook
 * extracted from useDataPanel in B-5 (H-0077). Most end-to-end paths
 * are covered by useDataPanel.test.ts; this file pins down the
 * contract of the isolated hook (params wiring + state mutation order)
 * so the extraction stays reversible.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo, ColumnsResponse, UiSchema } from "@/api/types";
import { INITIAL_BLOCKED_STATE } from "@/components/workspace/BlockedGroupKFoldEditor";
import {
  type CvState,
  INITIAL_CV_STATE,
} from "@/components/workspace/cv-state";

const mocks = vi.hoisted(() => ({
  fetchColumns: vi.fn(),
  fetchConfigDefaults: vi.fn(),
  updateConfig: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/api/workspace", () => ({
  fetchColumns: mocks.fetchColumns,
  fetchConfigDefaults: mocks.fetchConfigDefaults,
  updateConfig: mocks.updateConfig,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { useTargetSelection } from "./useTargetSelection";

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
  ],
};

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

// ``vi.fn()`` returns a widely-typed ``Mock<Procedure | Constructable>``
// that TS 5.x refuses to narrow to specific signatures like
// ``(flag: boolean) => void``. We pre-cast each mock so the renderHook
// call site accepts them without casting per-field.
type Fn<A extends unknown[] = never[]> = ((...args: A) => void) & {
  mock: { calls: A[] };
};

function fn<A extends unknown[] = never[]>(): Fn<A> {
  return vi.fn() as unknown as Fn<A>;
}

interface HookDeps {
  uiSchema?: UiSchema;
  setTarget: Fn<[string]>;
  setTask: Fn<[string]>;
  setCv: Fn<[CvState]>;
  setColumns: Fn<[ColumnInfo[]]>;
  setOverrides: Fn<[Record<string, unknown>]>;
  setSyncSuppressed: Fn<[boolean]>;
  preseedSyncKey: Fn<[string]>;
  onDataChanged: Fn<[]>;
  onTaskChanged: Fn<[string | null]>;
}

function setupHook(overrides: Partial<HookDeps> = {}) {
  const deps: HookDeps = {
    setTarget: fn(),
    setTask: fn(),
    setCv: fn(),
    setColumns: fn(),
    setOverrides: fn(),
    setSyncSuppressed: fn(),
    preseedSyncKey: fn(),
    onDataChanged: fn(),
    onTaskChanged: fn(),
    ...overrides,
  };
  const { result } = renderHook(
    () =>
      useTargetSelection({
        task: null,
        cv: INITIAL_CV_STATE,
        blocked: INITIAL_BLOCKED_STATE,
        dataPath: "/data/x.csv",
        uiSchema: deps.uiSchema,
        setTarget: deps.setTarget,
        setTask: deps.setTask,
        setCv: deps.setCv,
        setColumns: deps.setColumns,
        setOverrides: deps.setOverrides,
        setSyncSuppressed: deps.setSyncSuppressed,
        preseedSyncKey: deps.preseedSyncKey,
        onDataChanged: deps.onDataChanged,
        onTaskChanged: deps.onTaskChanged,
      }),
    { wrapper: createWrapper() },
  );
  return { result, deps };
}

describe("useTargetSelection", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset?.();
    // The hook schedules a rAF-based blur inside the finally block
    // (Radix focus workaround). Stubbing the callback to a no-op keeps
    // pending frames from leaking into the next test without having
    // to flush fake timers.
    vi.stubGlobal(
      "requestAnimationFrame",
      (_cb: FrameRequestCallback) => 0 as unknown as number,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps the mutation in setSyncSuppressed(true)/false bookends", async () => {
    mocks.fetchColumns.mockResolvedValue(COLS_OK);
    mocks.fetchConfigDefaults.mockResolvedValue({
      config_version: 1,
      task: "binary",
      data: {},
      features: {},
      split: { method: "kfold", n_splits: 5 },
      model: { name: "lgbm", params: {} },
    });
    mocks.updateConfig.mockResolvedValue(undefined);

    const { result, deps } = setupHook();

    await act(async () => {
      await result.current.handleTargetChange("a");
    });

    expect(deps.setSyncSuppressed).toHaveBeenNthCalledWith(1, true);
    expect(deps.setSyncSuppressed).toHaveBeenLastCalledWith(false);
  });

  it("propagates fetchColumns errors through a toast and still releases the suppress flag", async () => {
    mocks.fetchColumns.mockRejectedValue(new Error("column load failed"));

    const { result, deps } = setupHook();

    await act(async () => {
      await result.current.handleTargetChange("a");
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("Column detection failed"),
    );
    // Suppress flag must still be released even on error — otherwise
    // the next legitimate edit skips its sync silently.
    expect(deps.setSyncSuppressed).toHaveBeenLastCalledWith(false);
  });

  it("prefers uiSchema.capabilities.cv_default_strategy over the hard-coded fallback", async () => {
    mocks.fetchColumns.mockResolvedValue(COLS_OK);
    mocks.fetchConfigDefaults.mockResolvedValue({
      config_version: 1,
      task: "binary",
      data: {},
      features: {},
      split: { method: "kfold", n_splits: 5 },
      model: { name: "lgbm", params: {} },
    });
    mocks.updateConfig.mockResolvedValue(undefined);

    const uiSchema = {
      capabilities: {
        cv_default_strategy: { binary: "group_kfold" },
        cv_strategies: ["kfold", "group_kfold"],
        tune: { allow_empty_space: true },
      },
    } as unknown as UiSchema;

    const { result, deps } = setupHook({ uiSchema });

    await act(async () => {
      await result.current.handleTargetChange("a");
    });

    const setCvCall = deps.setCv.mock.calls.at(-1)?.[0];
    expect(setCvCall?.strategy).toBe("group_kfold");
  });
});
