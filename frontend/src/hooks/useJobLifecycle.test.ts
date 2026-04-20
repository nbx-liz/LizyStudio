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
});
