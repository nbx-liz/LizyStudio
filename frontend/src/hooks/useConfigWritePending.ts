import { useCallback, useSyncExternalStore } from "react";
import type { ConfigWriteFunnel } from "./useConfigWriteFunnel";

const noSubscription = () => () => {};

/**
 * True while the config write funnel holds a queued or in-flight write
 * (P-0110). The reactive form of `funnel.isFlushing()`.
 *
 * Owner ruling on PR #781 round 2: target select, preset load and undo /
 * redo each read a snapshot, write, then roll back or commit on that one
 * write's result. They are disabled while any write is pending so no
 * other write can interleave; their handlers also return early when
 * `isFlushing()` is true, for a call that bypasses the disabled control.
 *
 * A funnel without `subscribe` (a hand-written test stub) reads
 * `isFlushing()` once per render. With no funnel, nothing is pending.
 */
export function useConfigWritePending(
  funnel: ConfigWriteFunnel | null | undefined,
): boolean {
  const subscribe = funnel?.subscribe ?? noSubscription;
  const getSnapshot = useCallback(
    () => funnel?.isFlushing() ?? false,
    [funnel],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
