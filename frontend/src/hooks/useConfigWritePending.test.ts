import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useConfigWriteFunnel } from "./useConfigWriteFunnel";
import { useConfigWritePending } from "./useConfigWritePending";

/**
 * P-0110 round 2 (owner ruling: prevent the interleaving). Controls whose
 * handlers read a snapshot and then write — target select, preset load,
 * undo / redo — are disabled while the funnel holds a queued or in-flight
 * write. `useConfigWritePending` is the reactive form of the funnel's
 * existing `isFlushing()`.
 */
describe("useConfigWritePending", () => {
  function renderFunnel() {
    let release: (v: unknown) => void = () => {};
    const putConfig = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    // Stable options, as the funnel's own identity depends on them.
    const getCachedConfig = () => ({});
    const hook = renderHook(() => {
      const funnel = useConfigWriteFunnel({ getCachedConfig, putConfig });
      return { funnel, pending: useConfigWritePending(funnel) };
    });
    return { hook, putConfig, release: (v: unknown) => release(v) };
  }

  it("is true from enqueue until the queue drains, then false", async () => {
    const { hook, putConfig, release } = renderFunnel();
    expect(hook.result.current.pending).toBe(false);

    let write: Promise<unknown> = Promise.resolve();
    act(() => {
      write = hook.result.current.funnel.enqueueWrite({
        kind: "replace",
        config: { a: 1 },
        reason: "config-form-edit",
      });
    });
    expect(hook.result.current.pending).toBe(true);
    expect(hook.result.current.funnel.isFlushing()).toBe(true);

    await act(async () => {
      await Promise.resolve();
      release({ config: { a: 1 }, validation_errors: [] });
      await write;
      // Let the drain loop observe the empty queue.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(hook.result.current.pending).toBe(false);
    expect(hook.result.current.funnel.isFlushing()).toBe(false);
  });

  it("keeps the funnel object identity stable across pending changes", async () => {
    const { hook, release } = renderFunnel();
    const before = hook.result.current.funnel;
    let write: Promise<unknown> = Promise.resolve();
    act(() => {
      write = before.enqueueWrite({
        kind: "replace",
        config: {},
        reason: "undo",
      });
    });
    expect(hook.result.current.funnel).toBe(before);
    await act(async () => {
      await Promise.resolve();
      release({ config: {}, validation_errors: [] });
      await write;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.funnel).toBe(before);
  });

  it("is false without a funnel", () => {
    const { result } = renderHook(() => useConfigWritePending(null));
    expect(result.current).toBe(false);
  });
});
