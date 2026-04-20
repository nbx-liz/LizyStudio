import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDetail } from "@/api/types";
import { useJobProgress } from "./useJobProgress";

// Capture the callbacks passed to connectJobProgress so tests can
// simulate progress/completed/error messages without a real socket.
let lastCallbacks:
  | Parameters<typeof import("@/api/websocket").connectJobProgress>[1]
  | null = null;
const disconnectSpy = vi.fn();

vi.mock("@/api/websocket", () => ({
  connectJobProgress: vi.fn(
    (
      _id: string,
      callbacks: Parameters<
        typeof import("@/api/websocket").connectJobProgress
      >[1],
    ) => {
      lastCallbacks = callbacks;
      return disconnectSpy;
    },
  ),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function runningJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    job_id: "j1",
    status: "running",
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
  } as any;
}

function progressMsg(message: string, current = 1, total = 5) {
  return {
    type: "progress" as const,
    job_id: "j1",
    message,
    current,
    total,
    fold_results: null,
    trial_results: null,
  };
}

const completedMsg = {
  type: "completed" as const,
  job_id: "j1",
  message: "done",
};

const errorMsg = (msg: string) => ({
  type: "error" as const,
  job_id: "j1",
  message: msg,
  code: "TEST_ERROR",
});

beforeEach(() => {
  lastCallbacks = null;
  disconnectSpy.mockReset();
  vi.clearAllMocks();
});

describe("useJobProgress — WebSocket subscription", () => {
  it("does not subscribe when jobId is null", () => {
    renderHook(() => useJobProgress({ jobId: null, job: undefined }), {
      wrapper,
    });
    expect(lastCallbacks).toBeNull();
  });

  it("subscribes optimistically when job is still undefined", () => {
    renderHook(() => useJobProgress({ jobId: "j1", job: undefined }), {
      wrapper,
    });
    expect(lastCallbacks).not.toBeNull();
  });

  it("subscribes for running / pending jobs", () => {
    renderHook(() => useJobProgress({ jobId: "j1", job: runningJob() }), {
      wrapper,
    });
    expect(lastCallbacks).not.toBeNull();
  });

  it("does NOT subscribe when job is already terminal", () => {
    renderHook(
      () =>
        useJobProgress({
          jobId: "j1",
          job: runningJob({ status: "completed" }),
        }),
      { wrapper },
    );
    expect(lastCallbacks).toBeNull();
  });

  it("stores the latest progress message", () => {
    const { result } = renderHook(
      () => useJobProgress({ jobId: "j1", job: runningJob() }),
      { wrapper },
    );

    act(() => {
      lastCallbacks?.onProgress?.(progressMsg("fold 1"));
    });

    expect(result.current.progress?.message).toBe("fold 1");
  });

  it("accumulates fold log only when trackFoldLog is true", () => {
    const { result } = renderHook(
      () =>
        useJobProgress({
          jobId: "j1",
          job: runningJob(),
          trackFoldLog: true,
        }),
      { wrapper },
    );

    act(() => {
      lastCallbacks?.onProgress?.(progressMsg("fold 1", 1));
    });
    act(() => {
      lastCallbacks?.onProgress?.(progressMsg("fold 2", 2));
    });
    // Duplicate messages must not double-log
    act(() => {
      lastCallbacks?.onProgress?.(progressMsg("fold 2", 2));
    });

    expect(result.current.foldLog).toEqual(["fold 1", "fold 2"]);
  });

  it("does not track fold log when trackFoldLog is false", () => {
    const { result } = renderHook(
      () => useJobProgress({ jobId: "j1", job: runningJob() }),
      { wrapper },
    );

    act(() => {
      lastCallbacks?.onProgress?.(progressMsg("fold 1"));
    });

    expect(result.current.foldLog).toEqual([]);
  });

  it("clears progress + fires onTerminal on WS completed", () => {
    const onTerminal = vi.fn();
    const { result } = renderHook(
      () =>
        useJobProgress({
          jobId: "j1",
          job: runningJob(),
          onTerminal,
        }),
      { wrapper },
    );

    act(() => {
      lastCallbacks?.onProgress?.(progressMsg("fold 1"));
    });
    expect(result.current.progress).not.toBeNull();

    act(() => {
      lastCallbacks?.onCompleted?.(completedMsg);
    });
    expect(result.current.progress).toBeNull();
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it("fires onWsError and onTerminal on WS error", () => {
    const onTerminal = vi.fn();
    const onWsError = vi.fn();
    renderHook(
      () =>
        useJobProgress({
          jobId: "j1",
          job: runningJob(),
          onTerminal,
          onWsError,
        }),
      { wrapper },
    );

    act(() => {
      lastCallbacks?.onError?.(errorMsg("boom"));
    });

    expect(onWsError).toHaveBeenCalledWith("boom");
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it("disconnects when jobId changes", () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) =>
        useJobProgress({ jobId: id, job: runningJob() }),
      { wrapper, initialProps: { id: "j1" } },
    );
    expect(disconnectSpy).not.toHaveBeenCalled();

    rerender({ id: "j2" });
    expect(disconnectSpy).toHaveBeenCalled();
  });
});

describe("useJobProgress — polling fallback", () => {
  it("fires onTerminal when status transitions from running to terminal", () => {
    const onTerminal = vi.fn();
    const { rerender } = renderHook(
      ({ job }: { job: JobDetail | undefined }) =>
        useJobProgress({ jobId: "j1", job, onTerminal }),
      { wrapper, initialProps: { job: runningJob() } },
    );

    rerender({ job: runningJob({ status: "completed" }) });
    expect(onTerminal).toHaveBeenCalled();
  });

  it("fires onTerminal on first observation of an already-terminal job", () => {
    // Child-selection edge case: user clicks on a fast-completing
    // re-tune child that finished before the frontend subscribed.
    const onTerminal = vi.fn();
    renderHook(
      () =>
        useJobProgress({
          jobId: "j1",
          job: runningJob({ status: "failed" }),
          onTerminal,
        }),
      { wrapper },
    );
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it("fires onTerminal at most once per job when WS completed is then followed by a status flip", () => {
    // Regression: WS onCompleted invalidates the job query, which then
    // flips job.status to completed and triggers the polling-fallback
    // effect with prev === "running". Before the terminalFiredRef
    // guard, onTerminal fired twice.
    const onTerminal = vi.fn();
    const { rerender } = renderHook(
      ({ job }: { job: JobDetail | undefined }) =>
        useJobProgress({
          jobId: "j1",
          job,
          onTerminal,
        }),
      { wrapper, initialProps: { job: runningJob() } },
    );

    act(() => {
      lastCallbacks?.onCompleted?.(completedMsg);
    });
    // Simulate the query re-fetch firing next render cycle
    rerender({ job: runningJob({ status: "completed" }) });

    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it("clears foldLog when the polling fallback detects terminal", () => {
    // Regression: polling-only path (WS missed final message) must
    // still reset foldLog so the next job doesn't show stale fold
    // messages.
    const { result, rerender } = renderHook(
      ({ job }: { job: JobDetail | undefined }) =>
        useJobProgress({
          jobId: "j1",
          job,
          trackFoldLog: true,
        }),
      { wrapper, initialProps: { job: runningJob() } },
    );

    act(() => {
      lastCallbacks?.onProgress?.(progressMsg("fold 1"));
    });
    expect(result.current.foldLog).toEqual(["fold 1"]);

    // Skip onCompleted — simulate polling-only discovery of terminal
    rerender({ job: runningJob({ status: "completed" }) });
    expect(result.current.foldLog).toEqual([]);
  });

  it("does NOT fire onTerminal when switching BETWEEN two terminal jobs", () => {
    // Switching from a completed job to another completed job is not
    // a transition on the same job — it should reset the prev ref and
    // then fire once for the new job (first-observation case).
    const onTerminal = vi.fn();
    const { rerender } = renderHook(
      ({ id, job }: { id: string; job: JobDetail }) =>
        useJobProgress({ jobId: id, job, onTerminal }),
      {
        wrapper,
        initialProps: {
          id: "j1",
          job: runningJob({ job_id: "j1", status: "completed" }),
        },
      },
    );
    expect(onTerminal).toHaveBeenCalledTimes(1);

    rerender({
      id: "j2",
      job: runningJob({ job_id: "j2", status: "completed" }),
    });
    expect(onTerminal).toHaveBeenCalledTimes(2);
  });
});
