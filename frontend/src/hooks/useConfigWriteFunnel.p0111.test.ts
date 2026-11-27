import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TuningOverridesBody } from "@/api/workspace";
import {
  validationProblem,
  workspaceLockedProblem,
} from "@/test/problemDetails";
import { tuningOverridesFromConfig } from "./tuningOverridesBody";
import {
  type ConfigSnapshot,
  useConfigWriteFunnel,
} from "./useConfigWriteFunnel";

/**
 * P-0111: the funnel carries the Tune tab's two write paths.
 *
 * - `tuning_overrides` ops go to `PUT /config/tuning-overrides` (Q1), with
 *   the whole sparse intent as the body (REPLACE semantics);
 * - `legacy_config` ops go to the legacy `PUT /config` (Q1);
 * - both reasons share one queue and one drain, so they never run
 *   concurrently and a burst of both ends in ONE `onAllSettled` (Q2, Q3).
 */

function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

const BASE: ConfigSnapshot = {
  task: "binary",
  model: { params: { num_leaves: 31 } },
  tuning: {
    optuna: {
      params: { n_trials: 20 },
      space: { learning_rate: { type: "float", low: 0.01, high: 0.3 } },
    },
    evaluation: { metrics: ["auc"] },
  },
};

/**
 * A cache the funnel reads at flush time and `onWriteCommitted` updates,
 * as WorkspacePage wires it to the TanStack config entry.
 */
/**
 * A request-level stand-in for the backend's two config stores: the config
 * without `tuning`, and the sparse overrides. `PUT /config` follows
 * `absorb_legacy_tuning` (a body with `tuning` replaces the overrides, a
 * body without it leaves them) and echoes the request body, as
 * `api/workspace.py` does; `GET /config` follows `get_legacy_config_view`.
 */
function makeServer(config: ConfigSnapshot, overrides: TuningOverridesBody) {
  const state = { config, overrides };
  const view = (): ConfigSnapshot => {
    const o = state.overrides;
    const params: Record<string, unknown> = {};
    for (const key of ["n_trials", "timeout", "direction"] as const) {
      if (key in o) params[key] = o[key];
    }
    const optuna: Record<string, unknown> = {};
    if (Object.keys(params).length > 0) optuna.params = params;
    if (o.space && Object.keys(o.space).length > 0) optuna.space = o.space;
    const tuning: Record<string, unknown> = {};
    if (Object.keys(optuna).length > 0) tuning.optuna = optuna;
    if (o.evaluation_metrics != null) {
      tuning.evaluation = { metrics: o.evaluation_metrics };
    }
    return Object.keys(tuning).length > 0
      ? { ...state.config, tuning }
      : { ...state.config };
  };
  return {
    state,
    view,
    putConfig: vi.fn(async (body: ConfigSnapshot) => {
      const { tuning, ...rest } = body;
      if (tuning !== undefined) {
        state.overrides = tuningOverridesFromConfig({ tuning });
      }
      state.config = rest;
      return { config: body, validation_errors: [] };
    }),
    putTuningOverrides: vi.fn(async (body: TuningOverridesBody) => {
      state.overrides = body;
      return { tuning_effective: {} };
    }),
    readServerConfig: vi.fn(async () => view()),
  };
}

function makeCache(initial: ConfigSnapshot) {
  let current = initial;
  return {
    get: () => current,
    commit: (saved: ConfigSnapshot) => {
      const wrapper = saved as { config?: ConfigSnapshot };
      if (wrapper.config) current = wrapper.config;
    },
  };
}

describe("useConfigWriteFunnel — P-0111 tuning_overrides routing", () => {
  it("sends a tuning_overrides op to PUT /config/tuning-overrides with the whole intent, never to PUT /config", async () => {
    const cache = makeCache(BASE);
    const putConfig = vi.fn();
    const putTuningOverrides = vi.fn().mockResolvedValue({
      tuning_effective: {},
    });
    const onWriteCommitted = vi.fn(cache.commit);
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: cache.get,
        putConfig,
        putTuningOverrides,
        onWriteCommitted,
      }),
    );

    const res = await result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params"],
      value: { n_trials: 80 },
      reason: "tuning_overrides",
    });

    expect(res.ok).toBe(true);
    expect(putConfig).toHaveBeenCalledTimes(0);
    expect(putTuningOverrides).toHaveBeenCalledTimes(1);
    // REPLACE: the untouched space and metrics ride along with the edit.
    expect(putTuningOverrides).toHaveBeenCalledWith({
      n_trials: 80,
      space: { learning_rate: { type: "float", low: 0.01, high: 0.3 } },
      evaluation_metrics: ["auc"],
    });
    // The committed config reaches the cache in the legacy `{config}` shape.
    expect(onWriteCommitted).toHaveBeenCalledTimes(1);
    expect(cache.get()).toEqual({
      ...BASE,
      tuning: {
        ...(BASE.tuning as ConfigSnapshot),
        optuna: {
          params: { n_trials: 80 },
          space: { learning_rate: { type: "float", low: 0.01, high: 0.3 } },
        },
      },
    });
  });

  it("sends a legacy_config op to PUT /config, never to the overrides endpoint", async () => {
    const cache = makeCache(BASE);
    const putConfig = vi.fn(async (body: ConfigSnapshot) => ({
      config: body,
      validation_errors: [],
    }));
    const putTuningOverrides = vi.fn();
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: cache.get,
        putConfig,
        putTuningOverrides,
        onWriteCommitted: cache.commit,
      }),
    );

    await result.current.enqueueWrite({
      kind: "patch",
      path: ["model", "params", "num_leaves"],
      value: 63,
      reason: "legacy_config",
    });

    expect(putTuningOverrides).toHaveBeenCalledTimes(0);
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect((putConfig.mock.calls[0][0].model as ConfigSnapshot).params).toEqual(
      { num_leaves: 63 },
    );
  });

  it("a burst of both reasons is serialised in one drain, and the legacy body carries the tuning the overrides write committed (DC8)", async () => {
    const cache = makeCache(BASE);
    const inFlight: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const track = async <T>(label: string, value: T): Promise<T> => {
      inFlight.push(label);
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await flushMicrotasks();
      concurrent -= 1;
      return value;
    };
    const putTuningOverrides = vi.fn((body: unknown) =>
      track("overrides", { tuning_effective: body }),
    );
    const putConfig = vi.fn((body: ConfigSnapshot) =>
      track("legacy", { config: body, validation_errors: [] }),
    );
    const onAllSettled = vi.fn();
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: cache.get,
        putConfig,
        putTuningOverrides,
        onWriteCommitted: cache.commit,
        onAllSettled,
      }),
    );

    // One frame: a space edit (tuning field) and a Fixed value edit.
    const pSpace = result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "space"],
      value: {},
      reason: "tuning_overrides",
    });
    const pModel = result.current.enqueueWrite({
      kind: "patch",
      path: ["model", "params", "learning_rate"],
      value: 0.05,
      reason: "legacy_config",
    });
    const [rSpace, rModel] = await Promise.all([pSpace, pModel]);

    expect(rSpace.ok).toBe(true);
    expect(rModel.ok).toBe(true);
    expect(inFlight).toEqual(["overrides", "legacy"]);
    expect(maxConcurrent).toBe(1);
    expect(putTuningOverrides).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledTimes(1);
    // The legacy PUT's `tuning` block is the one the overrides write
    // committed, so the backend's absorb shim stores the same intent
    // instead of reverting the space edit.
    const legacyBody = putConfig.mock.calls[0][0];
    expect(
      ((legacyBody.tuning as ConfigSnapshot).optuna as ConfigSnapshot).space,
    ).toEqual({});
    expect((legacyBody.model as ConfigSnapshot).params).toEqual({
      num_leaves: 31,
      learning_rate: 0.05,
    });
    await flushMicrotasks();
    // Q2: one notification for the whole two-path burst.
    expect(onAllSettled).toHaveBeenCalledTimes(1);
  });

  it("an overrides write queued behind a legacy write seeds its body from the server's view after that write", async () => {
    const cache = makeCache(BASE);
    const { tuning: _baseTuning, ...baseWithoutTuning } = BASE;
    const server = makeServer(
      baseWithoutTuning,
      tuningOverridesFromConfig(BASE),
    );
    const { putConfig, putTuningOverrides, readServerConfig } = server;
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: cache.get,
        putConfig,
        putTuningOverrides,
        readServerConfig,
        onWriteCommitted: cache.commit,
      }),
    );

    // An undo restores n_trials=5 through the legacy path; a metric edit
    // queued behind it must not resurrect the pre-undo n_trials.
    const undone = {
      ...BASE,
      tuning: {
        optuna: { params: { n_trials: 5 } },
        evaluation: { metrics: ["auc"] },
      },
    };
    const pUndo = result.current.enqueueWrite({
      kind: "replace",
      config: undone,
      reason: "undo",
    });
    const pMetric = result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "evaluation"],
      value: { metrics: ["logloss"] },
      reason: "tuning_overrides",
    });
    await Promise.all([pUndo, pMetric]);

    expect(putTuningOverrides).toHaveBeenCalledTimes(1);
    expect(putTuningOverrides).toHaveBeenCalledWith({
      n_trials: 5,
      evaluation_metrics: ["logloss"],
    });
    // The legacy write left the cache holding its echo, so the seed was
    // re-read once from the server.
    expect(readServerConfig).toHaveBeenCalledTimes(1);
    expect(server.state.overrides).toEqual({
      n_trials: 5,
      evaluation_metrics: ["logloss"],
    });
  });

  it("an override survives a tuning-less legacy write: preset saved before any Tune edit, n_trials 200, preset load, timeout edit (round 1 finding 2)", async () => {
    // The preset was saved before any Tune edit, so it has no `tuning`.
    const preset: ConfigSnapshot = {
      task: "binary",
      model: { params: { num_leaves: 31 } },
    };
    const cache = makeCache(preset);
    const server = makeServer(preset, {});
    const { putConfig, putTuningOverrides, readServerConfig } = server;
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: cache.get,
        putConfig,
        putTuningOverrides,
        readServerConfig,
        onWriteCommitted: cache.commit,
      }),
    );

    await result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params", "n_trials"],
      value: 200,
      reason: "tuning_overrides",
    });
    expect(server.state.overrides).toEqual({ n_trials: 200 });

    // Load the preset: a legacy PUT without `tuning`. The server keeps the
    // override; the echo cached by the funnel has no `tuning` at all.
    await result.current.enqueueWrite({
      kind: "replace",
      config: preset,
      reason: "preset-load",
    });
    expect(server.state.overrides).toEqual({ n_trials: 200 });
    expect(cache.get().tuning).toBeUndefined();

    await result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params", "timeout"],
      value: 300,
      reason: "tuning_overrides",
    });

    expect(putTuningOverrides).toHaveBeenCalledTimes(2);
    expect(putTuningOverrides).toHaveBeenLastCalledWith({
      n_trials: 200,
      timeout: 300,
    });
    expect(server.state.overrides).toEqual({ n_trials: 200, timeout: 300 });
    // The cache now holds the server's tuning again.
    expect(
      ((cache.get().tuning as ConfigSnapshot).optuna as ConfigSnapshot).params,
    ).toEqual({ n_trials: 200, timeout: 300 });
  });

  it("an overrides write does not re-read the server when no legacy write committed before it", async () => {
    const cache = makeCache(BASE);
    const readServerConfig = vi.fn(async () => BASE);
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: cache.get,
        putConfig: vi.fn(),
        putTuningOverrides: vi.fn().mockResolvedValue({}),
        readServerConfig,
        onWriteCommitted: cache.commit,
      }),
    );

    await result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params", "n_trials"],
      value: 7,
      reason: "tuning_overrides",
    });
    expect(readServerConfig).toHaveBeenCalledTimes(0);
  });

  it("onAllSettled waits for a later write still in flight after an earlier one failed", async () => {
    let releaseSecond: () => void = () => {};
    const putConfig = vi.fn(
      () =>
        new Promise<ConfigSnapshot>((res) => {
          releaseSecond = () => res({ config: BASE });
        }),
    );
    const onAllSettled = vi.fn();
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => BASE,
        putConfig,
        putTuningOverrides: vi.fn().mockRejectedValue(validationProblem()),
        onAllSettled,
      }),
    );

    const pFailed = result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params", "n_trials"],
      value: 8,
      reason: "tuning_overrides",
    });
    const pHeld = result.current.enqueueWrite({
      kind: "patch",
      path: ["model", "params", "num_leaves"],
      value: 9,
      reason: "legacy_config",
    });

    expect(await pFailed).toMatchObject({ ok: false, error: "rejected" });
    await flushMicrotasks();
    // The first write settled (refused); the second is still open.
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(onAllSettled).toHaveBeenCalledTimes(0);
    expect(result.current.isFlushing()).toBe(true);

    releaseSecond();
    expect((await pHeld).ok).toBe(true);
    await flushMicrotasks();
    expect(onAllSettled).toHaveBeenCalledTimes(1);
  });

  it("coalesces same-frame tuning_overrides patches into one PUT carrying both edits", async () => {
    const cache = makeCache(BASE);
    const putTuningOverrides = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: cache.get,
        putConfig: vi.fn(),
        putTuningOverrides,
        onWriteCommitted: cache.commit,
      }),
    );

    const p1 = result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params"],
      value: { n_trials: 99 },
      reason: "tuning_overrides",
    });
    const p2 = result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "evaluation"],
      value: { metrics: ["logloss"] },
      reason: "tuning_overrides",
    });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(putTuningOverrides).toHaveBeenCalledTimes(1);
    expect(putTuningOverrides).toHaveBeenCalledWith({
      n_trials: 99,
      space: { learning_rate: { type: "float", low: 0.01, high: 0.3 } },
      evaluation_metrics: ["logloss"],
    });
  });

  it("a refused overrides write (422) is reported as rejected, leaves the cache alone and still settles once", async () => {
    const cache = makeCache(BASE);
    const onWriteCommitted = vi.fn(cache.commit);
    const onAllSettled = vi.fn();
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: cache.get,
        putConfig: vi.fn(),
        putTuningOverrides: vi.fn().mockRejectedValue(validationProblem()),
        onWriteCommitted,
        onAllSettled,
      }),
    );

    const res = await result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params"],
      value: { n_trials: 80 },
      reason: "tuning_overrides",
    });

    expect(res).toMatchObject({ ok: false, error: "rejected" });
    expect(onWriteCommitted).toHaveBeenCalledTimes(0);
    expect(cache.get()).toBe(BASE);
    await flushMicrotasks();
    expect(onAllSettled).toHaveBeenCalledTimes(1);
  });

  it("a 409 WORKSPACE_LOCKED from the overrides endpoint classifies as locked", async () => {
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => BASE,
        putConfig: vi.fn(),
        putTuningOverrides: vi.fn().mockRejectedValue(workspaceLockedProblem()),
      }),
    );

    const res = await result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params"],
      value: { n_trials: 80 },
      reason: "tuning_overrides",
    });

    expect(res).toMatchObject({ ok: false, error: "locked" });
  });

  it("an overrides write alone counts as a config write in flight (P-0110 guard)", async () => {
    let release: () => void = () => {};
    const putTuningOverrides = vi.fn(
      () =>
        new Promise<unknown>((res) => {
          release = () => res({});
        }),
    );
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => BASE,
        putConfig: vi.fn(),
        putTuningOverrides,
      }),
    );
    const listener = vi.fn();
    const unsubscribe = result.current.subscribe?.(listener);

    const p = result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params"],
      value: { n_trials: 80 },
      reason: "tuning_overrides",
    });
    await flushMicrotasks();
    expect(result.current.isFlushing()).toBe(true);
    // busy
    expect(listener).toHaveBeenCalledTimes(1);

    release();
    await p;
    await flushMicrotasks();
    expect(result.current.isFlushing()).toBe(false);
    // busy, then idle
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe?.();
  });

  it("calls onAllSettled once per drain, not once per write", async () => {
    const onAllSettled = vi.fn();
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => BASE,
        putConfig: vi.fn(async (body: ConfigSnapshot) => ({ config: body })),
        putTuningOverrides: vi.fn().mockResolvedValue({}),
        onAllSettled,
      }),
    );

    await result.current.enqueueWrite({
      kind: "patch",
      path: ["tuning", "optuna", "params"],
      value: { n_trials: 1 },
      reason: "tuning_overrides",
    });
    await flushMicrotasks();
    expect(onAllSettled).toHaveBeenCalledTimes(1);

    await result.current.enqueueWrite({
      kind: "patch",
      path: ["model", "params", "num_leaves"],
      value: 7,
      reason: "legacy_config",
    });
    await flushMicrotasks();
    // A second, separate drain.
    expect(onAllSettled).toHaveBeenCalledTimes(2);
  });
});
