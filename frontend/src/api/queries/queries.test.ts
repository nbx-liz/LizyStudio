/**
 * Contract tests for the api/queries/ thin-wrapper hook layer (B-7).
 *
 * Each hook must:
 *   - fire the expected fetcher exactly once with the expected args,
 *   - use the canonical query key from queryKeys.ts,
 *   - respect ``enabled`` / disabled-when-null gates.
 *
 * Mutation hooks must:
 *   - invalidate the correct caches on success so list views refresh,
 *   - surface errors through the hook state rather than swallowing.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../queryKeys";
import {
  useJobLineage,
  useJobLog,
  useJobsInvalidator,
  useJobsList,
  useResumeJob,
  useRetuneJob,
  useRunInference,
} from ".";

vi.mock("@/api/jobs", () => ({
  fetchJobs: vi.fn(),
  fetchJobLog: vi.fn(),
  fetchJobLineage: vi.fn(),
  retuneJob: vi.fn(),
  resumeJob: vi.fn(),
}));

vi.mock("@/api/inference", () => ({
  runInference: vi.fn(),
}));

import { runInference } from "@/api/inference";
import {
  fetchJobLineage,
  fetchJobLog,
  fetchJobs,
  resumeJob,
  retuneJob,
} from "@/api/jobs";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    qc,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe("useJobsList", () => {
  it("fetches the list and uses queryKeys.jobs() as the cache key", async () => {
    vi.mocked(fetchJobs).mockResolvedValueOnce([]);
    const { wrapper, qc } = makeWrapper();
    renderHook(() => useJobsList(), { wrapper });
    await waitFor(() => expect(fetchJobs).toHaveBeenCalledTimes(1));
    // The cache should be populated under the canonical key
    expect(qc.getQueryData(queryKeys.jobs())).toEqual([]);
  });
});

describe("useJobLog", () => {
  it("is disabled until enabled=true flips", async () => {
    const { wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => useJobLog("j1", { enabled: on }),
      { wrapper, initialProps: { on: false } },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchJobLog).not.toHaveBeenCalled();

    rerender({ on: true });
    await waitFor(() => expect(fetchJobLog).toHaveBeenCalledWith("j1"));
  });

  it("does not fetch when jobId is null", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useJobLog(null, { enabled: true }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchJobLog).not.toHaveBeenCalled();
  });
});

describe("useJobLineage", () => {
  it("fetches only when enabled=true", async () => {
    vi.mocked(fetchJobLineage).mockResolvedValue({
      tree: { job_id: "j1", children: [] } as never,
    });
    const { wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => useJobLineage("j1", { enabled: on }),
      { wrapper, initialProps: { on: false } },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchJobLineage).not.toHaveBeenCalled();

    rerender({ on: true });
    await waitFor(() => expect(fetchJobLineage).toHaveBeenCalledWith("j1"));
  });
});

// ---------------------------------------------------------------------------
// Invalidator helper
// ---------------------------------------------------------------------------

describe("useJobsInvalidator", () => {
  it("invalidates queryKeys.jobs() when called", () => {
    const { wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useJobsInvalidator(), { wrapper });
    result.current();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.jobs() });
  });
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

describe("useRetuneJob", () => {
  it("calls retuneJob and invalidates jobs + detail cache on success", async () => {
    vi.mocked(retuneJob).mockResolvedValueOnce({
      job_id: "child",
      parent_job_id: "j1",
    });
    const { wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRetuneJob(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        jobId: "j1",
        body: { n_trials: 10 },
      });
    });

    expect(retuneJob).toHaveBeenCalledWith("j1", { n_trials: 10 });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.jobs() });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.job("j1"),
    });
    // Post-#339 budget assertion: exactly the two invalidates declared
    // in onSuccess — no future cascade silently adds a third.
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});

describe("useResumeJob", () => {
  it("calls resumeJob and invalidates jobs + detail cache on success", async () => {
    vi.mocked(resumeJob).mockResolvedValueOnce({
      job_id: "child",
      parent_job_id: "j1",
    });
    const { wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useResumeJob(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        jobId: "j1",
        body: { n_trials: 5 },
      });
    });

    expect(resumeJob).toHaveBeenCalledWith("j1", { n_trials: 5 });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.jobs() });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.job("j1"),
    });
    // Post-#339 budget assertion: matches useRetuneJob — exactly two.
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});

describe("useRunInference", () => {
  it("calls runInference and invalidates infHistoryAll on success", async () => {
    vi.mocked(runInference).mockResolvedValueOnce({
      inf_id: "inf1",
      job_id: "j1",
    } as never);
    const { wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRunInference(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        job_id: "j1",
        data: { source_type: "path", path: "/data.csv" },
        return_shap: false,
        evaluate: true,
      });
    });

    expect(runInference).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.infHistoryAll(),
    });
    // Post-#339 budget assertion: single invalidate (infHistoryAll).
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Post-#339 budget assertion — invalidator helper fires exactly once
// ---------------------------------------------------------------------------

describe("useJobsInvalidator — budget", () => {
  it("invokes invalidateQueries exactly once per call", () => {
    const { wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useJobsInvalidator(), { wrapper });
    result.current();
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
