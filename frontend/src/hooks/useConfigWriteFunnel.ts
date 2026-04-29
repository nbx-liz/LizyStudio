import { useCallback, useEffect, useRef } from "react";
import { updateConfig } from "@/api/workspace";

/**
 * Write funnel for `PUT /api/workspace/config` (P-0092 Phase 1).
 *
 * Background — see HISTORY.md §P-0092 for the full diagnosis. The
 * Workspace currently has 6 writers spread across `useConfigSync`,
 * `useTargetSelection`, `useModelPanelData`, and `WorkspacePage`,
 * plus 5 cache writers. Every writer can step on every other one's
 * snapshot, and the resulting cross-hook race is what makes
 * `workspace-cv.spec.ts` (B-3) fail. Q-1's plan is to drain all
 * writers into a single funnel; this file is the funnel.
 *
 * Phase 1 scope (this file): own the queue, the state machine, and
 * the network call. **No existing writers are migrated yet** — that's
 * Phases 2..6 in the HISTORY.md plan. Until callers are migrated the
 * funnel is dead code in production; only the unit tests exercise it.
 *
 * Design notes:
 *
 * - `WriteOp` is the only thing callers send. It carries enough
 *   metadata (`reason`) for the funnel to decide which queued ops can
 *   be coalesced — same reason wins last (e.g., a rapid burst of
 *   `cv-change` writes from a stuck user collapses to one PUT) — and
 *   which must run in order (different reasons are serialised).
 *
 * - The state machine is intentionally tiny: `idle | flushing`. A
 *   third "draining the queue between flushes" state is implicit in
 *   the post-flush check inside `flushOne`. Avoiding an explicit
 *   "enqueueing" state keeps the reasoning simple — every public
 *   method either schedules work onto `pending` or awaits the
 *   in-flight `currentFlush` promise.
 *
 * - Aborting the in-flight network call (when Phase 5 wires
 *   useConfigSync's existing `AbortController`-based dedup into the
 *   funnel) is a Phase-5 concern. For Phase 1 we only need to make
 *   sure that a queued op is not lost while another is flushing —
 *   the simpler "wait, then send" semantics suffice.
 */

export type WriteReason =
  | "target-select"
  | "cv-change"
  | "config-form-edit"
  | "undo"
  | "redo"
  | "apply-to-fit"
  | "preset-load"
  | "auto-reset";

export type ConfigSnapshot = Record<string, unknown>;

export type WriteOp =
  | { kind: "replace"; config: ConfigSnapshot; reason: WriteReason }
  | {
      kind: "patch";
      path: readonly string[];
      value: unknown;
      reason: WriteReason;
    };

export type WriteResult =
  | { ok: true; saved: ConfigSnapshot }
  | {
      ok: false;
      error: "aborted" | "rejected" | "locked" | "network";
      details?: unknown;
    };

/**
 * Resolve a dotted path into the snapshot shape for `kind: "patch"`
 * ops. Mirrors `setNestedValue` in `config-utils.ts` but stays in
 * this module so the funnel has no implementation dependency on the
 * ConfigForm helpers (which are slated for restructuring in Phases
 * 2 and 4).
 */
function setNestedImmutable(
  base: ConfigSnapshot,
  path: readonly string[],
  value: unknown,
): ConfigSnapshot {
  if (path.length === 0) return base;
  const [head, ...rest] = path;
  const child = (base[head] ?? {}) as ConfigSnapshot;
  return {
    ...base,
    [head]: rest.length === 0 ? value : setNestedImmutable(child, rest, value),
  };
}

/**
 * Materialise a `WriteOp` against the current cache snapshot. Replace
 * ops pass through unchanged; patch ops are applied to `current` (or
 * an empty object if the cache is still cold) and the resulting
 * full-config body is returned.
 *
 * Returning an undefined snapshot from this function is forbidden:
 * funnel callers must always end up sending a full body, since the
 * server-side PUT handler treats the body as authoritative.
 */
export function materializeOp(
  op: WriteOp,
  current: ConfigSnapshot | undefined,
): ConfigSnapshot {
  if (op.kind === "replace") return op.config;
  return setNestedImmutable(current ?? {}, op.path, op.value);
}

/**
 * Coalesce two queued ops that share a `reason`. The latest wins
 * outright — partial merging across patch + replace would re-introduce
 * the cross-snapshot race the funnel exists to eliminate.
 */
export function coalesceByReason(queued: WriteOp, next: WriteOp): WriteOp {
  if (queued.reason !== next.reason) return next;
  return next;
}

interface FunnelState {
  /**
   * FIFO queue of pending ops. Same-reason coalescing collapses
   * consecutive entries into the latest one (see `enqueueWrite`).
   * Different-reason ops are preserved in arrival order so the
   * funnel honours the per-reason serialisation guarantee.
   */
  pending: WriteOp[];
  /** In-flight flush promise, or null when idle. */
  currentFlush: Promise<void> | null;
}

interface UseConfigWriteFunnelOptions {
  /**
   * Snapshot getter — typically `() => queryClient.getQueryData(...)`.
   * Called at flush time so the body sent to the server is built from
   * the freshest cached config rather than a stale closure capture.
   */
  getCachedConfig: () => ConfigSnapshot | undefined;
  /**
   * Called immediately after a successful PUT lands. Phase 5 will use
   * this to update the React Query cache atomically; Phase 1 leaves
   * it as an injectable hook so unit tests can observe terminal state
   * without coupling to TanStack Query.
   */
  onWriteCommitted?: (saved: ConfigSnapshot) => void;
  /**
   * Network call. Defaulted to `updateConfig` from `@/api/workspace`,
   * but injectable so unit tests can stub it without `vi.mock`.
   */
  putConfig?: (body: ConfigSnapshot) => Promise<unknown>;
}

/**
 * Public funnel API — the hook returns the writer-facing surface.
 * Existing call sites continue to import `updateConfig` directly until
 * the per-phase migrations replace them with `enqueueWrite`.
 */
export interface ConfigWriteFunnel {
  enqueueWrite: (op: WriteOp) => Promise<WriteResult>;
  /** True while a PUT is in flight. Useful for upstream guards. */
  isFlushing: () => boolean;
}

export function useConfigWriteFunnel(
  options: UseConfigWriteFunnelOptions,
): ConfigWriteFunnel {
  const {
    getCachedConfig,
    onWriteCommitted,
    putConfig = updateConfig,
  } = options;

  // The state lives in a ref so updates from inside the async flush
  // loop do not trigger re-renders. The hook does not own any visible
  // state — it is a side-effect coordinator.
  const stateRef = useRef<FunnelState>({
    pending: [],
    currentFlush: null,
  });

  // Resolver registry keyed on op identity so an enqueue can wait for
  // the specific PUT result that materialises its op (or its merged
  // successor, if it was coalesced into a later enqueue).
  const resolversRef = useRef<Map<WriteOp, (result: WriteResult) => void>>(
    new Map(),
  );

  const flushOne = useCallback(async (): Promise<void> => {
    const op = stateRef.current.pending.shift();
    if (op === undefined) return;

    const body = materializeOp(op, getCachedConfig());
    let result: WriteResult;
    try {
      const saved = (await putConfig(body)) as ConfigSnapshot;
      onWriteCommitted?.(saved);
      result = { ok: true, saved };
    } catch (err) {
      result = { ok: false, error: "network", details: err };
    }

    // Resolve all op promises that point at this flush. After
    // same-reason coalescing only the latest op of that reason
    // survives in `pending`, but earlier same-reason callers still
    // hold their handle in `resolversRef` and observe the same
    // saved snapshot.
    for (const [pendingOp, resolve] of resolversRef.current) {
      if (pendingOp.reason === op.reason) {
        resolve(result);
        resolversRef.current.delete(pendingOp);
      }
    }
  }, [getCachedConfig, onWriteCommitted, putConfig]);

  const drain = useCallback(async (): Promise<void> => {
    // Yield once before the first flush so any synchronous state
    // updates that follow `enqueueWrite` (cache writes, ref bumps)
    // settle before we read the snapshot. This mirrors how
    // useConfigSync's PUTs land in a microtask after the React
    // commit cycle, and is what closes the closure-time-vs-flush-time
    // gap that §P-0092 §Investigation Q-3 alone could not.
    await Promise.resolve();
    while (stateRef.current.pending.length > 0) {
      await flushOne();
    }
    stateRef.current = { ...stateRef.current, currentFlush: null };
  }, [flushOne]);

  const enqueueWrite = useCallback(
    (op: WriteOp): Promise<WriteResult> => {
      // Same-reason coalescing collapses into the queue's tail entry
      // when its reason matches `op.reason`. Cross-reason ops are
      // appended so target-select / cv-change / config-form-edit
      // bursts land in arrival order without one stomping the next.
      const queue = stateRef.current.pending;
      const tail = queue[queue.length - 1];
      if (tail && tail.reason === op.reason) {
        queue[queue.length - 1] = coalesceByReason(tail, op);
      } else {
        queue.push(op);
      }

      return new Promise<WriteResult>((resolve) => {
        resolversRef.current.set(op, resolve);
        if (stateRef.current.currentFlush === null) {
          const flushPromise = drain();
          stateRef.current = {
            ...stateRef.current,
            currentFlush: flushPromise,
          };
          // Failsafe: if drain rejects (it should not — flushOne
          // catches and converts to WriteResult), surface it as a
          // rejected promise to any pending resolver.
          flushPromise.catch((err) => {
            for (const [pending, r] of resolversRef.current) {
              r({ ok: false, error: "network", details: err });
              resolversRef.current.delete(pending);
            }
          });
        }
      });
    },
    [drain],
  );

  const isFlushing = useCallback(
    () => stateRef.current.currentFlush !== null,
    [],
  );

  // Cleanup on unmount: reject any unresolved promises so callers
  // do not hang. Phase 5 may relax this once the funnel is owned by
  // a Provider that outlives individual page mounts.
  useEffect(() => {
    return () => {
      for (const [op, resolve] of resolversRef.current) {
        resolve({ ok: false, error: "aborted" });
        resolversRef.current.delete(op);
      }
    };
  }, []);

  return {
    enqueueWrite,
    isFlushing,
  };
}
