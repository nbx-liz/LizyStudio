import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJobLifecycle } from "./useJobLifecycle";

vi.mock("@/api/jobs", () => ({
  fetchJob: vi.fn().mockResolvedValue({
    job_id: "j1",
    status: "running",
  }),
  cancelJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/api/websocket", () => ({
  connectJobProgress: vi.fn(() => () => {}),
}));

import { cancelJob, fetchJob } from "@/api/jobs";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useJobLifecycle", () => {
  it("returns the job from useJob", async () => {
    const { result } = renderHook(() => useJobLifecycle({ jobId: "j1" }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.job?.job_id).toBe("j1"));
  });

  it("cancel action calls cancelJob + fires onTerminal", async () => {
    const onTerminal = vi.fn();
    const { result } = renderHook(
      () => useJobLifecycle({ jobId: "j1", onTerminal }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.job?.status).toBe("running"));

    await act(async () => {
      await result.current.cancel();
    });

    expect(cancelJob).toHaveBeenCalledWith("j1");
    expect(onTerminal).toHaveBeenCalled();
  });

  it("cancel is a no-op when jobId is null", async () => {
    const { result } = renderHook(() => useJobLifecycle({ jobId: null }), {
      wrapper,
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it("does not fetch when jobId is null", async () => {
    renderHook(() => useJobLifecycle({ jobId: null }), { wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchJob).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------
  // Issue #237 — cancel failure must still release the UI
  // --------------------------------------------------------------------
  it("cancel rejection still clears progress + fires onTerminal (Issue #237)", async () => {
    const onTerminal = vi.fn();
    (cancelJob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("500 Internal Server Error"),
    );

    const { result } = renderHook(
      () => useJobLifecycle({ jobId: "j1", onTerminal }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.job?.status).toBe("running"));

    await act(async () => {
      await result.current.cancel();
    });

    // API was attempted.
    expect(cancelJob).toHaveBeenCalledWith("j1");
    // Even though the server errored, the UI must NOT stay in
    // "Cancelling..." — the parent's running flag is released via
    // onTerminal and the transient progress is cleared.
    expect(onTerminal).toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });

  // --------------------------------------------------------------------
  // Issue #238 — callback stability across renders
  // --------------------------------------------------------------------
  it("cancel reference stays stable across pure re-renders (Issue #238)", async () => {
    const { result, rerender } = renderHook(
      () => useJobLifecycle({ jobId: "j1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.job?.status).toBe("running"));

    const cancelA = result.current.cancel;
    rerender();
    const cancelB = result.current.cancel;
    rerender();
    const cancelC = result.current.cancel;

    // React.memo on downstream Button components relies on reference
    // equality. A fresh ``cancel`` each render defeats memoisation.
    expect(cancelA).toBe(cancelB);
    expect(cancelB).toBe(cancelC);
  });

  it("clearProgress reference stays stable across pure re-renders", async () => {
    const { result, rerender } = renderHook(
      () => useJobLifecycle({ jobId: "j1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.job?.status).toBe("running"));

    const clearA = result.current.clearProgress;
    rerender();
    const clearB = result.current.clearProgress;

    expect(clearA).toBe(clearB);
  });
});
