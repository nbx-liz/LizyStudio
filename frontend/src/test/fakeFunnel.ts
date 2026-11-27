import { act } from "@testing-library/react";
import { vi } from "vitest";
import type {
  ConfigWriteFunnel,
  WriteOp,
  WriteResult,
} from "@/hooks/useConfigWriteFunnel";

/**
 * A config write funnel whose busy state the test drives (P-0110 round 2).
 *
 * `setBusy(true)` stands for "another write is queued or in flight": it
 * flips `isFlushing()` and notifies `subscribe` listeners, so components
 * reading `useConfigWritePending` re-render disabled. Every
 * `enqueueWrite` is recorded, so a test can count the PUTs a handler
 * sent while it should have been a no-op.
 */
export function createControllableFunnel(
  respond: (op: WriteOp) => WriteResult | Promise<WriteResult> = () => ({
    ok: true,
    saved: { config: {}, validation_errors: [] },
  }),
) {
  let busy = false;
  const listeners = new Set<() => void>();
  const enqueueWrite = vi.fn(async (op: WriteOp) => respond(op));
  const funnel: ConfigWriteFunnel = {
    enqueueWrite,
    isFlushing: () => busy,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const setBusy = (next: boolean) => {
    act(() => {
      busy = next;
      for (const listener of listeners) listener();
    });
  };
  return { funnel, enqueueWrite, setBusy };
}
