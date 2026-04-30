/**
 * G-2 (P-0092 follow-up): cross-hook funnel integration test.
 *
 * The unit-level useConfigWriteFunnel.test.ts already covers the queue
 * machinery (coalesce, serialise, abort, network-fail). What it does
 * NOT prove is that real consumer hooks reading the funnel through
 * `ConfigWriteFunnelProvider + useConfigWriteFunnelOptional` actually
 * end up sharing the same `enqueueWrite` instance and observing the
 * same FIFO order under interleaving.
 *
 * The §P-0092 plan's central claim — "writers cannot cross-stomp" —
 * lives at the boundary between the funnel hook, the Provider, and
 * the consumer hooks. This file pins that boundary.
 */

import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigSnapshot,
  useConfigWriteFunnel,
  type WriteReason,
  type WriteResult,
} from "./useConfigWriteFunnel";
import {
  ConfigWriteFunnelProvider,
  useConfigWriteFunnelOptional,
} from "./useConfigWriteFunnelContext";

// Minimal stand-in for a real consumer hook: it pulls the funnel from
// context and exposes a `send` callback that enqueues with the given
// reason. This mirrors the shape of useConfigSync / useTargetSelection /
// useModelPanelData / useDataPanel without dragging in their
// TanStack Query + MSW + ColumnInfo dependencies. The thing under test
// is the Provider <-> consumer boundary, not the merged-config builders.
function useWriterConsumer(reason: WriteReason) {
  const funnel = useConfigWriteFunnelOptional();
  return {
    funnel,
    send: (config: ConfigSnapshot): Promise<WriteResult> | undefined =>
      funnel?.enqueueWrite({ kind: "replace", config, reason }),
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("funnel cross-hook integration (G-2)", () => {
  function makeWrapper(putConfig: (body: ConfigSnapshot) => Promise<unknown>) {
    // The funnel itself must live above the Provider so consumers can
    // read it. We mount it through a thin host component to mirror
    // WorkspacePage's wiring.
    function Host({ children }: { children: ReactNode }) {
      const funnel = useConfigWriteFunnel({
        getCachedConfig: () => undefined,
        putConfig,
      });
      return (
        <ConfigWriteFunnelProvider funnel={funnel}>
          {children}
        </ConfigWriteFunnelProvider>
      );
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Host>{children}</Host>
    );
    return wrapper;
  }

  it("all consumers under one Provider share the same funnel instance", async () => {
    const putConfig = vi
      .fn()
      .mockImplementation(async (body: ConfigSnapshot) => body);
    const wrapper = makeWrapper(putConfig);

    const { result } = renderHook(
      () => ({
        target: useWriterConsumer("target-select"),
        cv: useWriterConsumer("cv-change"),
        edit: useWriterConsumer("config-form-edit"),
      }),
      { wrapper },
    );

    expect(result.current.target.funnel).not.toBeNull();
    expect(result.current.target.funnel).toBe(result.current.cv.funnel);
    expect(result.current.cv.funnel).toBe(result.current.edit.funnel);
  });

  it("interleaved cross-hook writes are serialised in arrival order", async () => {
    // Hold the first PUT so we can stack a second consumer's write
    // behind it and observe that the funnel does NOT issue both PUTs
    // concurrently — the very behaviour the §P-0092 plan exists to
    // enforce across hooks (target-select must not race cv-change).
    const inFlight: ConfigSnapshot[] = [];
    let resolveFirst: (v: ConfigSnapshot) => void = () => {};
    const putConfig = vi
      .fn()
      .mockImplementation(async (body: ConfigSnapshot) => {
        inFlight.push(body);
        if (putConfig.mock.calls.length === 1) {
          return new Promise<ConfigSnapshot>((res) => {
            resolveFirst = res;
          });
        }
        return body;
      });
    const wrapper = makeWrapper(putConfig);

    const { result } = renderHook(
      () => ({
        target: useWriterConsumer("target-select"),
        cv: useWriterConsumer("cv-change"),
        edit: useWriterConsumer("config-form-edit"),
      }),
      { wrapper },
    );

    // Three different consumers fire near-simultaneously, the way the
    // production tree does when the user picks a target column (which
    // cascades into a target-select PUT) and then immediately switches
    // CV strategy (cv-change) and tweaks a search-space row
    // (config-form-edit) before the first PUT settles.
    const p1 = result.current.target.send({ task: "binary" });
    const p2 = result.current.cv.send({ split: { method: "kfold" } });
    const p3 = result.current.edit.send({ training: { lr: 0.01 } });

    await flushMicrotasks();

    // Only the first PUT may be in flight; the funnel must hold the
    // other two in the queue, not issue them concurrently.
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]).toEqual({ task: "binary" });

    resolveFirst({ task: "binary" });
    await Promise.all([p1, p2, p3]);

    // All three reasons land, in arrival order, with no concurrency.
    expect(putConfig).toHaveBeenCalledTimes(3);
    expect(putConfig.mock.calls[0][0]).toEqual({ task: "binary" });
    expect(putConfig.mock.calls[1][0]).toEqual({
      split: { method: "kfold" },
    });
    expect(putConfig.mock.calls[2][0]).toEqual({ training: { lr: 0.01 } });
  });

  it("same-reason bursts from different consumers coalesce into the latest", async () => {
    // Two distinct consumers both holding the cv-change reason (e.g.
    // useConfigSync's Phase-5 cv-change PUT racing with a hypothetical
    // CvSection-internal cv-change writer) must coalesce, not double-PUT.
    let resolveFirst: (v: ConfigSnapshot) => void = () => {};
    const putConfig = vi
      .fn()
      .mockImplementation(async (body: ConfigSnapshot) => {
        if (putConfig.mock.calls.length === 1) {
          return new Promise<ConfigSnapshot>((res) => {
            resolveFirst = res;
          });
        }
        return body;
      });
    const wrapper = makeWrapper(putConfig);

    const { result } = renderHook(
      () => ({
        cvA: useWriterConsumer("cv-change"),
        cvB: useWriterConsumer("cv-change"),
      }),
      { wrapper },
    );

    // First PUT enters in-flight; subsequent same-reason ops must
    // collapse into the queue's single tail entry.
    const p1 = result.current.cvA.send({ split: { method: "kfold" } });
    await flushMicrotasks();
    expect(putConfig).toHaveBeenCalledTimes(1);

    const p2 = result.current.cvB.send({
      split: { method: "stratified_kfold" },
    });
    const p3 = result.current.cvA.send({ split: { method: "time_series" } });

    resolveFirst({ split: { method: "kfold" } });
    await Promise.all([p1, p2, p3]);

    // After the in-flight PUT settles, the funnel issues exactly ONE
    // more PUT carrying the latest snapshot — not two.
    expect(putConfig).toHaveBeenCalledTimes(2);
    expect(putConfig.mock.calls[1][0]).toEqual({
      split: { method: "time_series" },
    });
  });

  it("a consumer that fires post-unmount receives an aborted result instead of hanging", async () => {
    let resolve: (v: ConfigSnapshot) => void = () => {};
    const putConfig = vi.fn().mockImplementation(
      () =>
        new Promise<ConfigSnapshot>((res) => {
          resolve = res;
        }),
    );
    const wrapper = makeWrapper(putConfig);

    const { result, unmount } = renderHook(
      () => useWriterConsumer("target-select"),
      { wrapper },
    );

    // Stack two ops so the second is still in the pending queue when
    // the host unmounts. The first stays in-flight (we never resolve
    // it), but its resolver also lives in resolversRef and must be
    // drained on unmount or the caller hangs forever.
    const p1 = result.current.send({ task: "binary" });
    const p2 = result.current.send({ task: "regression" });
    if (!p1 || !p2) throw new Error("Funnel must be mounted under Provider");

    await flushMicrotasks();
    unmount();

    const r1 = await p1;
    const r2 = await p2;
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toBe("aborted");
    if (!r2.ok) expect(r2.error).toBe("aborted");

    // Sanity: the `resolve` we captured for the in-flight call is
    // still the local closure — calling it now should not blow up
    // even though the Map entry was deleted.
    resolve({ task: "binary" });
  });

  it("consumer outside any Provider receives a null funnel and degrades gracefully", async () => {
    // The Optional hook is the production-safe path for component-level
    // tests / Storybook stories. Pin that contract here so a future
    // refactor that flips it to throw cannot ship without breaking
    // this test.
    const { result } = renderHook(() => useWriterConsumer("config-form-edit"));
    expect(result.current.funnel).toBeNull();
    // send() short-circuits to undefined when no funnel is mounted —
    // it is the consumer's job to fall back to a legacy writer.
    expect(result.current.send({ task: "binary" })).toBeUndefined();
    await waitFor(() => expect(result.current.funnel).toBeNull());
  });
});
