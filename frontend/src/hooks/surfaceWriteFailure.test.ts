import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { N_SPLITS_ERROR, validationProblem } from "@/test/problemDetails";
import { surfaceWriteFailure } from "./surfaceWriteFailure";
import { useConfigWriteFunnel } from "./useConfigWriteFunnel";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo, success: vi.fn() },
}));

describe("surfaceWriteFailure", () => {
  beforeEach(() => {
    mocks.toastError.mockReset();
    mocks.toastInfo.mockReset();
  });

  // P-0110: ConfigForm's objective and metric auto-resets are two
  // same-reason ops; the real funnel coalesces them into ONE PUT and
  // resolves both callers with that PUT's result. A refusal of that one
  // PUT must reach the user once, not once per caller.
  it("shows one toast for one refused PUT that two coalesced resets share", async () => {
    let rejectPut: (err: unknown) => void = () => {};
    const putConfig = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectPut = reject;
        }),
    );
    const { result } = renderHook(() =>
      useConfigWriteFunnel({
        getCachedConfig: () => ({ model: { params: {} } }),
        putConfig,
      }),
    );

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current
        .enqueueWrite({
          kind: "patch",
          path: ["model", "params", "objective"],
          value: "binary",
          reason: "auto-reset",
        })
        .then(surfaceWriteFailure);
      second = result.current
        .enqueueWrite({
          kind: "patch",
          path: ["model", "params", "metric"],
          value: ["auc"],
          reason: "auto-reset",
        })
        .then(surfaceWriteFailure);
    });
    await act(async () => {
      await Promise.resolve();
      rejectPut(validationProblem());
      await Promise.all([first, second]);
    });

    expect(putConfig).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith(
      `Config not saved: ${N_SPLITS_ERROR.message}`,
    );
  });

  it("shows each of two separate refused PUTs", () => {
    surfaceWriteFailure({
      ok: false,
      error: "rejected",
      details: validationProblem(),
    });
    surfaceWriteFailure({
      ok: false,
      error: "rejected",
      details: validationProblem(),
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(2);
  });

  it("is silent for a committed or aborted write", () => {
    surfaceWriteFailure({ ok: true, saved: {} });
    surfaceWriteFailure({ ok: false, error: "aborted" });
    expect(mocks.toastError).toHaveBeenCalledTimes(0);
    expect(mocks.toastInfo).toHaveBeenCalledTimes(0);
  });
});
