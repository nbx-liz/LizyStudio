import { useCallback, useEffect, useMemo, useRef } from "react";
import { ApiError } from "@/api/client";
import { isWorkspaceLocked } from "@/api/errors";
import {
  fetchConfig,
  type TuningOverridesBody,
  updateConfig,
  updateTuningOverrides,
} from "@/api/workspace";
import { tuningOverridesFromConfig } from "./tuningOverridesBody";

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
  | "auto-reset"
  // P-0111: the Tune tab's two write paths. `tuning_overrides` ops are
  // sent to `PUT /config/tuning-overrides`; `legacy_config` ops carry the
  // Tune-tab fields that endpoint cannot hold (`model.params`, the inner
  // split marker, `tuning.re_tune`) to the legacy `PUT /config`.
  | "legacy_config"
  | "tuning_overrides";

/** The two P-0111 Tune-tab write paths. */
export type TuneWriteReason = Extract<
  WriteReason,
  "legacy_config" | "tuning_overrides"
>;

export type ConfigSnapshot = Record<string, unknown>;

export interface PatchEntry {
  readonly path: readonly string[];
  readonly value: unknown;
}

export type WriteOp =
  | { kind: "replace"; config: ConfigSnapshot; reason: WriteReason }
  | {
      kind: "patch";
      path: readonly string[];
      value: unknown;
      reason: WriteReason;
    }
  | {
      /**
       * Multi-path patch, produced by `coalesceByReason` when two
       * same-reason `kind: "patch"` ops with DIFFERENT paths sit
       * adjacent in the queue. Issue #530: the original "latest wins
       * outright" coalesce silently discarded the earlier path's
       * value, which let `ConfigForm`'s auto-reset useEffect lose
       * `model.params.objective` every time it co-fired with
       * `model.params.metric`. Folding both into a single op keeps
       * the funnel race-free without flattening per-path intent.
       */
      kind: "patch-many";
      patches: readonly PatchEntry[];
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
  if (Array.isArray(base)) {
    const result = [...base];
    const index = Number(head);
    result[index] =
      rest.length === 0
        ? value
        : setNestedImmutable(result[index] ?? {}, rest, value);
    return result as unknown as ConfigSnapshot;
  }
  if (rest.length === 0 && value === undefined) {
    // P-0111: `undefined` removes the key. The JSON body would omit it
    // anyway; removing it keeps the cached config equal to what was sent.
    const { [head]: _removed, ...without } = base;
    return without;
  }
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
  if (op.kind === "patch") {
    return setNestedImmutable(current ?? {}, op.path, op.value);
  }
  // patch-many: apply each entry in order onto the snapshot. Later
  // entries with the same path override earlier ones — this matches
  // how `coalesceByReason` already de-dupes when merging.
  let snapshot = current ?? {};
  for (const entry of op.patches) {
    snapshot = setNestedImmutable(snapshot, entry.path, entry.value);
  }
  return snapshot;
}

/** Stable string key for a path so set / filter ops can de-dupe by identity. */
function pathKey(path: readonly string[]): string {
  return path.join("\u0000");
}

/**
 * Coalesce two queued ops that share a `reason`.
 *
 * Issue #530 (PR-B): the original "latest wins outright" implementation
 * silently dropped the earlier op even when `queued` and `next` were
 * `kind: "patch"` ops with DIFFERENT paths. That let `ConfigForm`'s
 * auto-reset useEffect lose `model.params.objective` every time it
 * fired alongside `model.params.metric` — and the next render saw
 * objective still empty, re-fired both, lost objective again, etc.
 * Target-select produced 4 PUTs (one target-select replace + three
 * auto-reset patches in this oscillation) instead of the 2 it should
 * have taken.
 *
 * The new rule:
 *
 * - **`next` is a replace** ⇒ replace always wins. Replace ops carry
 *   an authoritative full body, so dropping the queued op is the only
 *   safe behaviour. (This includes `replace + replace` which was the
 *   only well-tested case under the legacy semantics.)
 *
 * - **`next` is a patch and `queued` is also a patch / patch-many** ⇒
 *   merge into a `kind: "patch-many"` carrying both path/value pairs.
 *   Later same-path entries override earlier ones; different-path
 *   entries are preserved. This is the fix for #530.
 *
 * - **`queued` is a replace and `next` is a patch** ⇒ replace wins
 *   (defensive: this combination is not used by any current caller,
 *   but a patch over a replace would either silently drop the
 *   authoritative body or require reading the replace's snapshot at
 *   coalesce time, both of which violate the funnel's "build the body
 *   at flush time" invariant). Keeping `next` here would lose the
 *   replace's body; keeping `queued` discards the patch. We discard
 *   the patch and document the choice.
 *
 * Callers gate on `tail.reason === next.reason` before invoking this
 * helper, so we only see same-reason pairs here.
 */
export function coalesceByReason(queued: WriteOp, next: WriteOp): WriteOp {
  if (next.kind === "replace") return next;
  if (queued.kind === "replace") return queued;
  // Both are patch / patch-many. Merge into a patch-many op where
  // later entries with the same path override earlier ones.
  const queuedPatches: readonly PatchEntry[] =
    queued.kind === "patch-many"
      ? queued.patches
      : [{ path: queued.path, value: queued.value }];
  const nextPatches: readonly PatchEntry[] =
    next.kind === "patch-many"
      ? next.patches
      : [{ path: next.path, value: next.value }];
  const nextKeys = new Set(nextPatches.map((p) => pathKey(p.path)));
  const survivors = queuedPatches.filter((p) => !nextKeys.has(pathKey(p.path)));
  return {
    kind: "patch-many",
    patches: [...survivors, ...nextPatches],
    reason: next.reason,
  };
}

/**
 * Classify a thrown error from the network layer into a discrete
 * `WriteResult.error` tag so consumers can branch on the failure
 * mode without rummaging through `details`. G-6: the funnel used
 * to flatten everything into `"network"` and rely on every caller
 * to re-detect 409 WORKSPACE_LOCKED itself.
 */
function classifyPutError(err: unknown): {
  error: "locked" | "rejected" | "network";
  details: unknown;
} {
  if (err instanceof ApiError) {
    // P-0110: PUT /config answers RFC 9457 Problem Details; the accessor
    // reads the code from either envelope.
    if (isWorkspaceLocked(err)) {
      return { error: "locked", details: err };
    }
    // A blocking validation rejection is a 422 here (P-0110), so the
    // backend not saving the body always lands on this branch.
    if (err.status >= 400 && err.status < 500) {
      return { error: "rejected", details: err };
    }
  }
  return { error: "network", details: err };
}

/**
 * One queued PUT: the (possibly coalesced) op to send, and every caller
 * op folded into it. Issue #614: resolving by `reason` alone also settled
 * same-reason callers still waiting in `pending` with an earlier PUT's
 * result, and dropped their own. Each caller is resolved only by the PUT
 * whose entry lists its op in `sources`.
 */
interface QueueEntry {
  readonly op: WriteOp;
  readonly sources: readonly WriteOp[];
}

interface FunnelState {
  /**
   * FIFO queue of pending entries. Same-reason coalescing collapses
   * consecutive entries into the latest one (see `enqueueWrite`).
   * Different-reason ops are preserved in arrival order so the
   * funnel honours the per-reason serialisation guarantee.
   */
  pending: QueueEntry[];
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
   * Called immediately after a successful PUT lands. WorkspacePage
   * uses this to update the React Query cache atomically with the
   * server-side saved snapshot. Optional so unit tests can observe
   * terminal state without coupling to TanStack Query.
   */
  onWriteCommitted?: (saved: ConfigSnapshot) => void;
  /**
   * Network call. Defaulted to `updateConfig` from `@/api/workspace`,
   * but injectable so unit tests can stub it without `vi.mock`.
   */
  putConfig?: (body: ConfigSnapshot) => Promise<unknown>;
  /**
   * P-0111: network call for `tuning_overrides` ops. Defaulted to
   * `updateTuningOverrides`; injectable like `putConfig`.
   */
  putTuningOverrides?: (body: TuningOverridesBody) => Promise<unknown>;
  /**
   * P-0111: reads the server's config view (`GET /config`). A legacy
   * `PUT /config` answers with the request body, not with what the server
   * stored: its absorb shim keeps the stored overrides when the body has no
   * `tuning` block, and drops a metric-derived `direction`. So after a
   * legacy write commits, the cached `tuning` block is no longer a faithful
   * seed for the overrides endpoint's REPLACE, and the next
   * `tuning_overrides` op re-reads the view first. Defaulted to
   * `fetchConfig`; injectable like `putConfig`.
   */
  readServerConfig?: () => Promise<ConfigSnapshot>;
  /**
   * P-0111 Q2: called once each time the queue drains, after the last
   * write of the drain settled (committed or refused). WorkspacePage
   * invalidates the Tune snapshot here, once, instead of once per write.
   */
  onAllSettled?: () => void;
}

/**
 * Public funnel API — the hook returns the writer-facing surface.
 * Existing call sites continue to import `updateConfig` directly until
 * the per-phase migrations replace them with `enqueueWrite`.
 */
export interface ConfigWriteFunnel {
  enqueueWrite: (op: WriteOp) => Promise<WriteResult>;
  /** True while a write is queued or in flight. Useful for upstream guards. */
  isFlushing: () => boolean;
  /**
   * Subscribe to `isFlushing()` changes (P-0110): the listener runs when
   * the funnel goes busy or idle. Read it through `useConfigWritePending`.
   * Optional so hand-written test stubs need not implement it; the real
   * funnel always provides it.
   */
  subscribe?: (listener: () => void) => () => void;
}

// Module-level (stable identity) and resolved at call time, so a test that
// mocks `@/api/workspace` without this export only fails if it sends one.
const defaultPutTuningOverrides = (body: TuningOverridesBody) =>
  updateTuningOverrides(body);
const defaultReadServerConfig = () => fetchConfig();

export function useConfigWriteFunnel(
  options: UseConfigWriteFunnelOptions,
): ConfigWriteFunnel {
  const {
    getCachedConfig,
    onWriteCommitted,
    putConfig = updateConfig,
    putTuningOverrides = defaultPutTuningOverrides,
    readServerConfig = defaultReadServerConfig,
    onAllSettled,
  } = options;

  // True after a legacy PUT committed: the cache then holds that request's
  // echo, not the server's view, until a `tuning_overrides` op re-reads it.
  const seedStaleRef = useRef(false);

  // Held in a ref so an inline callback does not change `drain`'s, and so
  // the returned funnel's, identity on every render.
  const onAllSettledRef = useRef(onAllSettled);
  onAllSettledRef.current = onAllSettled;

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

  // P-0110: listeners of the busy / idle transitions of `isFlushing()`,
  // read reactively through `useConfigWritePending`. Kept in a ref so the
  // returned funnel object keeps its identity (consumers put it in effect
  // dependencies).
  const listenersRef = useRef<Set<() => void>>(new Set());
  const notifyPending = useCallback(() => {
    for (const listener of listenersRef.current) listener();
  }, []);

  const flushOne = useCallback(async (): Promise<void> => {
    const entry = stateRef.current.pending.shift();
    if (entry === undefined) return;

    let result: WriteResult;
    try {
      let saved: ConfigSnapshot;
      if (entry.op.reason === "tuning_overrides") {
        // P-0111: the edit is applied at flush time to the server's
        // config, so the body is the whole sparse intent the endpoint's
        // REPLACE needs. The cache is that config unless a legacy write
        // committed since (see `readServerConfig`); then it is re-read.
        // The endpoint answers only the effective config; the saved
        // config is the materialised body, reported in the same `{config}`
        // shape as a legacy PUT so `onWriteCommitted` updates the cache
        // before the next queued op reads it (a legacy op that read a
        // stale `tuning` block would revert this write).
        const base = seedStaleRef.current
          ? await readServerConfig()
          : getCachedConfig();
        const body = materializeOp(entry.op, base);
        await putTuningOverrides(tuningOverridesFromConfig(body));
        seedStaleRef.current = false;
        saved = { config: body };
      } else {
        const body = materializeOp(entry.op, getCachedConfig());
        saved = (await putConfig(body)) as ConfigSnapshot;
        seedStaleRef.current = true;
      }
      onWriteCommitted?.(saved);
      result = { ok: true, saved };
    } catch (err) {
      const classified = classifyPutError(err);
      result = { ok: false, ...classified };
    }

    // Resolve exactly the callers whose ops this PUT carried (#614).
    // Same-reason ops still queued behind it keep their resolvers and
    // observe their own PUT's result.
    for (const source of entry.sources) {
      const resolve = resolversRef.current.get(source);
      if (resolve !== undefined) {
        resolve(result);
        resolversRef.current.delete(source);
      }
    }
  }, [
    getCachedConfig,
    onWriteCommitted,
    putConfig,
    putTuningOverrides,
    readServerConfig,
  ]);

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
    notifyPending();
    // P-0111 Q2: one notification per drain, after both write paths settled.
    onAllSettledRef.current?.();
  }, [flushOne, notifyPending]);

  const enqueueWrite = useCallback(
    (op: WriteOp): Promise<WriteResult> => {
      // Same-reason coalescing collapses into the queue's tail entry
      // when its reason matches `op.reason`. Cross-reason ops are
      // appended so target-select / cv-change / config-form-edit
      // bursts land in arrival order without one stomping the next.
      const queue = stateRef.current.pending;
      const tail = queue[queue.length - 1];
      if (tail && tail.op.reason === op.reason) {
        queue[queue.length - 1] = {
          op: coalesceByReason(tail.op, op),
          sources: [...tail.sources, op],
        };
      } else {
        queue.push({ op, sources: [op] });
      }

      return new Promise<WriteResult>((resolve) => {
        resolversRef.current.set(op, resolve);
        if (stateRef.current.currentFlush === null) {
          const flushPromise = drain();
          stateRef.current = {
            ...stateRef.current,
            currentFlush: flushPromise,
          };
          notifyPending();
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
    [drain, notifyPending],
  );

  const isFlushing = useCallback(
    () => stateRef.current.currentFlush !== null,
    [],
  );

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

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

  // P-0092 Q-1 Phase 5: stabilise the public API object reference
  // so consumers that pull the funnel via context can put it in
  // useEffect dependencies (e.g. `useConfigSync`) without firing
  // a re-render storm. `enqueueWrite` and `isFlushing` are already
  // useCallback-stabilised, so `useMemo` here only collapses the
  // object identity — its dep array intentionally does not depend
  // on render-time scope, just on the two stable callbacks.
  return useMemo(
    () => ({
      enqueueWrite,
      isFlushing,
      subscribe,
    }),
    [enqueueWrite, isFlushing, subscribe],
  );
}
