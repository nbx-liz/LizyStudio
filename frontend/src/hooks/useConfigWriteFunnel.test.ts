import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigSnapshot,
  coalesceByReason,
  materializeOp,
  useConfigWriteFunnel,
  type WriteOp,
} from "./useConfigWriteFunnel";

/**
 * Phase 1 invariants for the write funnel (P-0092).
 *
 * The funnel is the substrate the rest of P-0092 builds on, so these
 * tests deliberately stay at the level of "the queue does what it
 * promises" — concrete writer migrations come in Phases 2..6 and
 * grow their own integration tests then. Each `describe` block
 * locks one invariant from the HISTORY.md plan.
 */

function flushMicrotasks() {
  return new Promise((r) => setTimeout(r, 0));
}

describe("materializeOp", () => {
  it("replace ops pass through verbatim", () => {
    const op: WriteOp = {
      kind: "replace",
      config: { task: "binary", split: { method: "kfold" } },
      reason: "cv-change",
    };
    const out = materializeOp(op, { task: "regression" });
    expect(out).toEqual({ task: "binary", split: { method: "kfold" } });
  });

  it("patch ops merge onto the current cache snapshot", () => {
    const current: ConfigSnapshot = {
      task: "binary",
      training: { early_stopping: { rounds: 100 } },
    };
    const op: WriteOp = {
      kind: "patch",
      path: ["training", "early_stopping", "rounds"],
      value: 50,
      reason: "config-form-edit",
    };
    const out = materializeOp(op, current);
    expect(out).toEqual({
      task: "binary",
      training: { early_stopping: { rounds: 50 } },
    });
    // Original snapshot must not mutate — ConfigForm relies on
    // referential equality to skip useEffect runs that have not
    // observed real changes.
    expect(current.training).toEqual({ early_stopping: { rounds: 100 } });
  });

  it("patch ops handle a cold cache by starting from an empty object", () => {
    const op: WriteOp = {
      kind: "patch",
      path: ["split", "method"],
      value: "kfold",
      reason: "cv-change",
    };
    expect(materializeOp(op, undefined)).toEqual({
      split: { method: "kfold" },
    });
  });
});

describe("coalesceByReason", () => {
  it("collapses two same-reason replace ops to the latter (last write wins)", () => {
    const a: WriteOp = {
      kind: "replace",
      config: { split: { method: "kfold" } },
      reason: "cv-change",
    };
    const b: WriteOp = {
      kind: "replace",
      config: { split: { method: "stratified_kfold" } },
      reason: "cv-change",
    };
    expect(coalesceByReason(a, b)).toBe(b);
  });

  it("keeps the new op when the reasons differ", () => {
    const a: WriteOp = {
      kind: "replace",
      config: { split: { method: "kfold" } },
      reason: "cv-change",
    };
    const b: WriteOp = {
      kind: "replace",
      config: { task: "binary" },
      reason: "target-select",
    };
    expect(coalesceByReason(a, b)).toBe(b);
  });

  // Issue #530: two same-reason patches at DIFFERENT paths must merge
  // into a patch-many op carrying BOTH path/value pairs. The original
  // "last write wins" semantics silently dropped the first path.
  it("merges two same-reason patches with different paths into a patch-many op", () => {
    const a: WriteOp = {
      kind: "patch",
      path: ["model", "params", "objective"],
      value: "binary",
      reason: "auto-reset",
    };
    const b: WriteOp = {
      kind: "patch",
      path: ["model", "params", "metric"],
      value: ["auc", "binary_logloss"],
      reason: "auto-reset",
    };
    const merged = coalesceByReason(a, b);
    expect(merged.kind).toBe("patch-many");
    if (merged.kind !== "patch-many") throw new Error("expected patch-many op");
    expect(merged.reason).toBe("auto-reset");
    expect(merged.patches).toEqual([
      { path: ["model", "params", "objective"], value: "binary" },
      {
        path: ["model", "params", "metric"],
        value: ["auc", "binary_logloss"],
      },
    ]);
  });

  it("collapses two same-reason patches at the SAME path to the latter (last value wins)", () => {
    const a: WriteOp = {
      kind: "patch",
      path: ["model", "params", "objective"],
      value: "binary",
      reason: "auto-reset",
    };
    const b: WriteOp = {
      kind: "patch",
      path: ["model", "params", "objective"],
      value: "cross_entropy",
      reason: "auto-reset",
    };
    const merged = coalesceByReason(a, b);
    expect(merged.kind).toBe("patch-many");
    if (merged.kind !== "patch-many") throw new Error("expected patch-many op");
    expect(merged.patches).toEqual([
      { path: ["model", "params", "objective"], value: "cross_entropy" },
    ]);
  });

  it("extends an existing patch-many op with a new same-reason patch", () => {
    const a: WriteOp = {
      kind: "patch-many",
      patches: [
        { path: ["model", "params", "objective"], value: "binary" },
        { path: ["model", "params", "metric"], value: ["auc"] },
      ],
      reason: "auto-reset",
    };
    const b: WriteOp = {
      kind: "patch",
      path: ["model", "params", "learning_rate"],
      value: 0.01,
      reason: "auto-reset",
    };
    const merged = coalesceByReason(a, b);
    expect(merged.kind).toBe("patch-many");
    if (merged.kind !== "patch-many") throw new Error("expected patch-many op");
    expect(merged.patches).toEqual([
      { path: ["model", "params", "objective"], value: "binary" },
      { path: ["model", "params", "metric"], value: ["auc"] },
      { path: ["model", "params", "learning_rate"], value: 0.01 },
    ]);
  });

  it("a same-path patch overrides the earlier entry inside an existing patch-many", () => {
    const a: WriteOp = {
      kind: "patch-many",
      patches: [
        { path: ["model", "params", "objective"], value: "binary" },
        { path: ["model", "params", "metric"], value: ["auc"] },
      ],
      reason: "auto-reset",
    };
    const b: WriteOp = {
      kind: "patch",
      path: ["model", "params", "metric"],
      value: ["accuracy", "f1"],
      reason: "auto-reset",
    };
    const merged = coalesceByReason(a, b);
    expect(merged.kind).toBe("patch-many");
    if (merged.kind !== "patch-many") throw new Error("expected patch-many op");
    expect(merged.patches).toEqual([
      { path: ["model", "params", "objective"], value: "binary" },
      { path: ["model", "params", "metric"], value: ["accuracy", "f1"] },
    ]);
  });

  it("a replace op coalesced after a patch wins outright (replace carries authoritative body)", () => {
    const a: WriteOp = {
      kind: "patch",
      path: ["model", "params", "objective"],
      value: "binary",
      reason: "auto-reset",
    };
    const b: WriteOp = {
      kind: "replace",
      config: { task: "regression" },
      reason: "auto-reset",
    };
    expect(coalesceByReason(a, b)).toBe(b);
  });

  it("a patch op coalesced after a replace keeps the replace (patch cannot override an authoritative body)", () => {
    const a: WriteOp = {
      kind: "replace",
      config: { task: "binary" },
      reason: "auto-reset",
    };
    const b: WriteOp = {
      kind: "patch",
      path: ["model", "params", "objective"],
      value: "binary",
      reason: "auto-reset",
    };
    expect(coalesceByReason(a, b)).toBe(a);
  });
});

describe("materializeOp — patch-many", () => {
  it("applies each entry in order onto the cache snapshot", () => {
    const op: WriteOp = {
      kind: "patch-many",
      patches: [
        { path: ["model", "params", "objective"], value: "binary" },
        { path: ["model", "params", "metric"], value: ["auc"] },
      ],
      reason: "auto-reset",
    };
    const current: ConfigSnapshot = {
      task: "binary",
      model: { name: "lgbm", params: { learning_rate: 0.01 } },
    };
    const out = materializeOp(op, current);
    expect(out).toEqual({
      task: "binary",
      model: {
        name: "lgbm",
        params: {
          learning_rate: 0.01,
          objective: "binary",
          metric: ["auc"],
        },
      },
    });
  });

  it("handles a cold cache for patch-many ops", () => {
    const op: WriteOp = {
      kind: "patch-many",
      patches: [
        { path: ["a"], value: 1 },
        { path: ["b", "c"], value: 2 },
      ],
      reason: "auto-reset",
    };
    expect(materializeOp(op, undefined)).toEqual({ a: 1, b: { c: 2 } });
  });
});

describe("useConfigWriteFunnel", () => {
  it("flushes a single replace op via putConfig and resolves with the saved snapshot", async () => {
    const putConfig = vi.fn().mockResolvedValue({
      task: "binary",
      split: { method: "kfold" },
    });
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
      }),
    );

    const promise = result.current.enqueueWrite({
      kind: "replace",
      config: { task: "binary", split: { method: "kfold" } },
      reason: "cv-change",
    });

    const res = await promise;
    expect(res).toEqual({
      ok: true,
      saved: { task: "binary", split: { method: "kfold" } },
    });
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig).toHaveBeenCalledWith({
      task: "binary",
      split: { method: "kfold" },
    });
  });

  it("invokes onWriteCommitted with the saved snapshot", async () => {
    const onWriteCommitted = vi.fn();
    const putConfig = vi
      .fn()
      .mockResolvedValue({ task: "binary", split: { method: "kfold" } });
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
        onWriteCommitted,
      }),
    );

    await result.current.enqueueWrite({
      kind: "replace",
      config: { task: "binary", split: { method: "kfold" } },
      reason: "cv-change",
    });

    expect(onWriteCommitted).toHaveBeenCalledWith({
      task: "binary",
      split: { method: "kfold" },
    });
  });

  it("coalesces a synchronous burst of same-reason replace ops into a single PUT", async () => {
    // The exact race we are killing in Phase 5: a synchronous burst
    // of cv-strategy clicks must not generate four PUTs whose
    // ordering is racy. Because `drain` yields one microtask before
    // the first flush, all enqueues posted before that microtask
    // boundary collapse into one PUT carrying only the final
    // selection. (A cross-microtask burst — e.g. user clicking again
    // *after* the first PUT has started — produces a second flush;
    // that case is covered by the next test.)
    const putConfig = vi
      .fn()
      .mockImplementation((body: ConfigSnapshot) => Promise.resolve(body));

    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
      }),
    );

    const p1 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "kfold" } },
      reason: "cv-change",
    });
    const p2 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "stratified_kfold" } },
      reason: "cv-change",
    });
    const p3 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "group_kfold" } },
      reason: "cv-change",
    });
    const p4 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "time_series" } },
      reason: "cv-change",
    });

    const results = await Promise.all([p1, p2, p3, p4]);

    // All four enqueues observe the same final body — coalesced.
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.saved).toEqual({ split: { method: "time_series" } });
    }
    // Single PUT — the entire burst collapsed before flush started.
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(putConfig.mock.calls[0][0]).toEqual({
      split: { method: "time_series" },
    });
  });

  it("a second burst arriving after the first PUT starts produces a second coalesced flush", async () => {
    // Cross-microtask burst: the first enqueue starts a flush, then
    // a follow-up burst lands while that flush is in flight. The
    // second burst must not overwrite the in-flight body, but must
    // itself coalesce, and must run only after the first PUT clears.
    let resolveFirst: (v: ConfigSnapshot) => void = () => {};
    const putConfig = vi.fn().mockImplementation((body: ConfigSnapshot) => {
      if (putConfig.mock.calls.length === 1) {
        return new Promise<ConfigSnapshot>((res) => {
          resolveFirst = res;
        });
      }
      return Promise.resolve(body);
    });

    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
      }),
    );

    const p1 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "kfold" } },
      reason: "cv-change",
    });
    // Let the drain microtask fire so the first PUT is actually in
    // flight before the next burst arrives.
    await flushMicrotasks();
    expect(putConfig).toHaveBeenCalledTimes(1);

    const p2 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "stratified_kfold" } },
      reason: "cv-change",
    });
    const p3 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "time_series" } },
      reason: "cv-change",
    });

    resolveFirst({ split: { method: "kfold" } });
    await Promise.all([p1, p2, p3]);

    expect(putConfig).toHaveBeenCalledTimes(2);
    expect(putConfig.mock.calls[0][0]).toEqual({ split: { method: "kfold" } });
    expect(putConfig.mock.calls[1][0]).toEqual({
      split: { method: "time_series" },
    });
  });

  it("serialises ops with different reasons (no two PUTs in flight)", async () => {
    const inFlight: ConfigSnapshot[] = [];
    let resolveFirst: (v: ConfigSnapshot) => void = () => {};
    const putConfig = vi.fn().mockImplementation((body: ConfigSnapshot) => {
      inFlight.push(body);
      if (putConfig.mock.calls.length === 1) {
        return new Promise<ConfigSnapshot>((res) => {
          resolveFirst = res;
        });
      }
      return Promise.resolve(body);
    });

    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
      }),
    );

    const p1 = result.current.enqueueWrite({
      kind: "replace",
      config: { task: "binary" },
      reason: "target-select",
    });
    const p2 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "kfold" } },
      reason: "cv-change",
    });

    await flushMicrotasks();
    // Only the first op should be in flight while we hold its
    // resolver — the funnel is serial, not parallel.
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]).toEqual({ task: "binary" });

    resolveFirst({ task: "binary" });
    await Promise.all([p1, p2]);

    expect(putConfig).toHaveBeenCalledTimes(2);
    expect(putConfig.mock.calls[1][0]).toEqual({ split: { method: "kfold" } });
  });

  it("isFlushing reflects in-flight state and clears after drain", async () => {
    let resolve: (v: ConfigSnapshot) => void = () => {};
    const putConfig = vi.fn().mockImplementation(
      () =>
        new Promise<ConfigSnapshot>((res) => {
          resolve = res;
        }),
    );

    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
      }),
    );

    expect(result.current.isFlushing()).toBe(false);

    const p = result.current.enqueueWrite({
      kind: "replace",
      config: { task: "binary" },
      reason: "target-select",
    });
    await flushMicrotasks();
    expect(result.current.isFlushing()).toBe(true);

    resolve({ task: "binary" });
    await p;
    // Allow the drain loop to wind down before reading the flag.
    await flushMicrotasks();
    expect(result.current.isFlushing()).toBe(false);
  });

  it("converts a putConfig rejection into a network WriteResult without throwing", async () => {
    const putConfig = vi.fn().mockRejectedValue(new Error("backend down"));
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
      }),
    );

    const res = await result.current.enqueueWrite({
      kind: "replace",
      config: { task: "binary" },
      reason: "target-select",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("network");
      expect(res.details).toBeInstanceOf(Error);
    }
  });

  it("aborts pending ops on unmount", async () => {
    let resolve: (v: ConfigSnapshot) => void = () => {};
    const putConfig = vi.fn().mockImplementation(
      () =>
        new Promise<ConfigSnapshot>((res) => {
          resolve = res;
        }),
    );

    const { result, unmount } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
      }),
    );

    const p1 = result.current.enqueueWrite({
      kind: "replace",
      config: { task: "binary" },
      reason: "target-select",
    });
    // Queue a second op behind the first in-flight one so unmount
    // observes a pending resolver.
    const p2 = result.current.enqueueWrite({
      kind: "replace",
      config: { split: { method: "kfold" } },
      reason: "cv-change",
    });

    await flushMicrotasks();
    unmount();

    // The second op had not flushed yet, so its resolver was held by
    // resolversRef. Unmount should drain it with `aborted` so callers
    // do not leak a pending Promise.
    const r2 = await p2;
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe("aborted");

    // Resolve the in-flight call so the leftover putConfig promise
    // does not leak past the test.
    resolve({ task: "binary" });
    await p1.catch(() => {});
  });

  it("materialises a patch op against the freshest cached config at flush time, not enqueue time", async () => {
    // This is the closure-race fix from §P-0092 in miniature: the
    // body sent to the server must be derived from the cache as it
    // looks when the funnel is about to flush, not from a snapshot
    // captured when the caller invoked enqueueWrite.
    let cached: ConfigSnapshot = {
      split: { method: "stratified_kfold", n_splits: 5 },
    };
    const putConfig = vi
      .fn()
      .mockImplementation((body: ConfigSnapshot) => Promise.resolve(body));

    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => cached,
        putConfig,
      }),
    );

    // Simulate an external writer landing a fresher cv-state into
    // the cache between enqueue and flush.
    const promise = result.current.enqueueWrite({
      kind: "patch",
      path: ["split", "n_splits"],
      value: 7,
      reason: "config-form-edit",
    });
    cached = {
      split: { method: "group_kfold", n_splits: 5 },
      data: { target: "y" },
    };

    const res = await promise;
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.saved).toEqual({
        split: { method: "group_kfold", n_splits: 7 },
        data: { target: "y" },
      });
    }
  });

  // ----------------------------------------------------------------------
  // G-6 — putConfig error classification.
  //
  // Before this PR the funnel flattened every thrown error into
  // `error: "network"`, leaving every caller (useConfigSync,
  // useModelPanelData) to re-detect ApiError + WORKSPACE_LOCKED themselves.
  // The classifier in flushOne now distinguishes locked / rejected / network
  // so callers can branch on `error` directly.
  // ----------------------------------------------------------------------
  describe("error classification (G-6)", () => {
    it("classifies 409 WORKSPACE_LOCKED as error=locked", async () => {
      const { ApiError } = await import("@/api/client");
      const err = new ApiError(409, {
        error: {
          code: "WORKSPACE_LOCKED",
          message: "Config is locked while job xyz is running",
          details: { job_id: "xyz" },
        },
      });
      const putConfig = vi.fn().mockRejectedValue(err);
      const { result } = renderHook(() =>
        useConfigWriteFunnel({
          getCachedConfig: () => undefined,
          putConfig,
        }),
      );

      const res = await result.current.enqueueWrite({
        kind: "replace",
        config: { task: "binary" },
        reason: "config-form-edit",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("locked");
        // Original error stays in details so callers that want the
        // structured body (job_id etc.) can reach it.
        expect(res.details).toBe(err);
      }
    });

    it("classifies 4xx ApiErrors that are NOT lock as error=rejected", async () => {
      const { ApiError } = await import("@/api/client");
      const err = new ApiError(422, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Body validation failed",
          details: {},
        },
      });
      const putConfig = vi.fn().mockRejectedValue(err);
      const { result } = renderHook(() =>
        useConfigWriteFunnel({
          getCachedConfig: () => undefined,
          putConfig,
        }),
      );

      const res = await result.current.enqueueWrite({
        kind: "replace",
        config: { task: "binary" },
        reason: "config-form-edit",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("rejected");
    });

    it("classifies generic thrown errors as error=network", async () => {
      const putConfig = vi.fn().mockRejectedValue(new Error("dns gone"));
      const { result } = renderHook(() =>
        useConfigWriteFunnel({
          getCachedConfig: () => undefined,
          putConfig,
        }),
      );

      const res = await result.current.enqueueWrite({
        kind: "replace",
        config: { task: "binary" },
        reason: "config-form-edit",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("network");
    });

    it("classifies 5xx ApiErrors as error=network (not rejected)", async () => {
      const { ApiError } = await import("@/api/client");
      const err = new ApiError(500, {
        error: { code: "INTERNAL", message: "boom", details: {} },
      });
      const putConfig = vi.fn().mockRejectedValue(err);
      const { result } = renderHook(() =>
        useConfigWriteFunnel({
          getCachedConfig: () => undefined,
          putConfig,
        }),
      );

      const res = await result.current.enqueueWrite({
        kind: "replace",
        config: { task: "binary" },
        reason: "config-form-edit",
      });
      expect(res.ok).toBe(false);
      // Server-side faults are not "rejected by validation" and not
      // "locked". They fall through to the network bucket so callers
      // surface the generic retry path.
      if (!res.ok) expect(res.error).toBe("network");
    });
  });

  // ----------------------------------------------------------------------
  // G-8 — ConfigUpdateResponse wrapper passes through onWriteCommitted.
  //
  // Production putConfig is `updateConfig` from @/api/workspace, which
  // returns `{config, errors, saved}` (not just the flat config). The
  // funnel must NOT unwrap that itself — the wrapper stays the truth that
  // WorkspacePage's onWriteCommitted reads from to set the cache and
  // observe `saved=false`. Earlier wrapper-leak bugs (Phase 4 follow-up)
  // came from a writer assuming the funnel flattened the body.
  // ----------------------------------------------------------------------
  describe("response shape pass-through (G-8)", () => {
    it("forwards the full ConfigUpdateResponse wrapper to onWriteCommitted", async () => {
      const wrapper = {
        config: { task: "binary", split: { method: "kfold" } },
        errors: [],
        saved: true,
      };
      const putConfig = vi.fn().mockResolvedValue(wrapper);
      const onWriteCommitted = vi.fn();

      const { result } = renderHook(() =>
        useConfigWriteFunnel({
          getCachedConfig: () => undefined,
          putConfig,
          onWriteCommitted,
        }),
      );

      const res = await result.current.enqueueWrite({
        kind: "replace",
        config: { task: "binary" },
        reason: "target-select",
      });

      // The funnel must NOT flatten or peek inside `saved` — the
      // wrapper goes through verbatim so the Page-level callback owns
      // the saved=false branching.
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.saved).toBe(wrapper);
      expect(onWriteCommitted).toHaveBeenCalledTimes(1);
      expect(onWriteCommitted).toHaveBeenCalledWith(wrapper);
    });

    it("forwards a saved=false wrapper without throwing", async () => {
      // Even a backend-rejected wrapper is still "ok" at the funnel
      // layer (the HTTP call succeeded). The hook caller observes
      // `saved=false` and surfaces the toast itself.
      const wrapper = {
        config: { task: "binary" },
        errors: [{ path: "data", message: "Field required" }],
        saved: false,
      };
      const putConfig = vi.fn().mockResolvedValue(wrapper);
      const onWriteCommitted = vi.fn();

      const { result } = renderHook(() =>
        useConfigWriteFunnel({
          getCachedConfig: () => undefined,
          putConfig,
          onWriteCommitted,
        }),
      );

      const res = await result.current.enqueueWrite({
        kind: "replace",
        config: { task: "binary" },
        reason: "config-form-edit",
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.saved).toBe(wrapper);
      expect(onWriteCommitted).toHaveBeenCalledWith(wrapper);
    });
  });
});
