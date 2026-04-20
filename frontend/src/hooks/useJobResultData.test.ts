/**
 * Tests for useJobResultData — the shared data-fetching hook that backs
 * both Workspace's ResultsCompletedView and Jobs page's CompletedContent.
 *
 * The hook must:
 *   - Fire the 8 plot/score/importance/tuning queries in a single place
 *     so the two call sites cannot drift.
 *   - Fetch LC metrics from the backend endpoint (the Workspace source of
 *     truth), not from client-side config parsing (the Jobs page shortcut).
 *   - Expose derived data (pivoted metrics, fold count, annotateMetric)
 *     so consumers render identically.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDetail, MetricEntry } from "@/api/types";
import { useJobResultData } from "./useJobResultData";

vi.mock("@/api/jobs", () => ({
  fetchJobPlots: vi.fn().mockResolvedValue([]),
  fetchJobPlot: vi.fn().mockResolvedValue({ plotly_json: "{}" }),
  fetchJobImportance: vi.fn().mockResolvedValue({}),
  fetchJobImportanceKinds: vi.fn().mockResolvedValue([]),
  fetchJobLearningCurveMetrics: vi.fn().mockResolvedValue([]),
  fetchJobSplitSummary: vi.fn().mockResolvedValue([]),
}));

import {
  fetchJobImportance,
  fetchJobImportanceKinds,
  fetchJobLearningCurveMetrics,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
} from "@/api/jobs";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function makeJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    job_id: "j1",
    job_type: "fit",
    status: "completed",
    backend_name: "lizyml",
    model_name: "LightGBM",
    config: { model: { name: "LightGBM" } },
    data_ref: {
      source_type: "path",
      path: "/data.csv",
      filename: "data.csv",
      fingerprint: "abc",
      shape: [10, 3],
    },
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
    error: null,
    primary_score: 0.9,
    fit_result: null,
    tune_result: null,
    model_path: null,
    parent_job_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useJobResultData", () => {
  // -------------------------------------------------------------------------
  // Basic query fan-out
  // -------------------------------------------------------------------------
  it("fetches plots, split summary on mount", async () => {
    const job = makeJob();
    renderHook(() => useJobResultData({ job, selectedPlot: "" }), { wrapper });

    await waitFor(() => {
      expect(fetchJobPlots).toHaveBeenCalledWith("j1");
      expect(fetchJobSplitSummary).toHaveBeenCalledWith("j1");
    });
  });

  it("does NOT fetch the generic plot when selectedPlot is empty", async () => {
    const job = makeJob();
    renderHook(() => useJobResultData({ job, selectedPlot: "" }), { wrapper });

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchJobPlot).not.toHaveBeenCalledWith("j1", "", expect.anything());
  });

  it("fetches generic plot when a non-LC / non-importance plot is selected", async () => {
    const job = makeJob();
    renderHook(
      () => useJobResultData({ job, selectedPlot: "confusion_matrix" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(fetchJobPlot).toHaveBeenCalledWith("j1", "confusion_matrix");
    });
  });

  // -------------------------------------------------------------------------
  // Learning curve
  // -------------------------------------------------------------------------
  it("fetches LC metrics from backend when LC plot is selected and available", async () => {
    const job = makeJob();
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["learning-curve"]);
    vi.mocked(fetchJobLearningCurveMetrics).mockResolvedValueOnce([
      "rmse",
      "mae",
    ]);

    renderHook(
      () => useJobResultData({ job, selectedPlot: "learning-curve" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(fetchJobLearningCurveMetrics).toHaveBeenCalledWith("j1");
    });
  });

  it("does NOT fetch LC metrics when LC plot is not available", async () => {
    const job = makeJob();
    vi.mocked(fetchJobPlots).mockResolvedValueOnce([]);

    renderHook(
      () => useJobResultData({ job, selectedPlot: "learning-curve" }),
      { wrapper },
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchJobLearningCurveMetrics).not.toHaveBeenCalled();
  });

  it("auto-initializes lcMetric to the first backend-reported metric", async () => {
    const job = makeJob();
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["learning-curve"]);
    vi.mocked(fetchJobLearningCurveMetrics).mockResolvedValueOnce([
      "rmse",
      "mae",
    ]);

    const { result } = renderHook(
      () => useJobResultData({ job, selectedPlot: "learning-curve" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.lcMetric).toBe("rmse");
    });
  });

  it("keeps lcMetric null when only a single metric is reported", async () => {
    const job = makeJob();
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["learning-curve"]);
    vi.mocked(fetchJobLearningCurveMetrics).mockResolvedValueOnce(["rmse"]);

    const { result } = renderHook(
      () => useJobResultData({ job, selectedPlot: "learning-curve" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.availableEvalMetrics).toEqual(["rmse"]);
    });
    // Single metric → no filter needed, stays null
    expect(result.current.lcMetric).toBeNull();
  });

  it("resets lcMetric when job_id changes", async () => {
    const job1 = makeJob({ job_id: "j1" });
    const job2 = makeJob({ job_id: "j2" });
    vi.mocked(fetchJobPlots).mockResolvedValue(["learning-curve"]);
    vi.mocked(fetchJobLearningCurveMetrics)
      .mockResolvedValueOnce(["rmse", "mae"])
      .mockResolvedValueOnce(["rmse", "mae"]);

    const { result, rerender } = renderHook(
      ({ job }) => useJobResultData({ job, selectedPlot: "learning-curve" }),
      { wrapper, initialProps: { job: job1 } },
    );

    await waitFor(() => expect(result.current.lcMetric).toBe("rmse"));

    act(() => {
      result.current.setLcMetric("mae");
    });
    expect(result.current.lcMetric).toBe("mae");

    rerender({ job: job2 });

    // After job change, lcMetric resets before new metrics arrive
    await waitFor(() => {
      expect(result.current.lcMetric).not.toBe("mae");
    });
  });

  it("drops a stale lcMetric when backend list no longer contains it", async () => {
    const job = makeJob();
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["learning-curve"]);
    vi.mocked(fetchJobLearningCurveMetrics).mockResolvedValueOnce([
      "rmse",
      "mae",
    ]);

    const { result } = renderHook(
      () => useJobResultData({ job, selectedPlot: "learning-curve" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.lcMetric).toBe("rmse"));

    act(() => {
      result.current.setLcMetric("not_a_real_metric");
    });

    await waitFor(() => {
      expect(result.current.lcMetric).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Importance
  // -------------------------------------------------------------------------
  it("fetches importance kinds and plot when importance plot is available", async () => {
    const job = makeJob();
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["importance"]);
    vi.mocked(fetchJobImportanceKinds).mockResolvedValueOnce(["split", "gain"]);

    renderHook(() => useJobResultData({ job, selectedPlot: "" }), { wrapper });

    await waitFor(() => {
      expect(fetchJobImportanceKinds).toHaveBeenCalledWith("j1");
      expect(fetchJobImportance).toHaveBeenCalledWith("j1", "split");
      expect(fetchJobPlot).toHaveBeenCalledWith("j1", "importance", {
        kind: "split",
      });
    });
  });

  it("syncs importanceKind when backend list doesn't include current value", async () => {
    const job = makeJob();
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["importance"]);
    vi.mocked(fetchJobImportanceKinds).mockResolvedValueOnce(["gain", "shap"]);

    const { result } = renderHook(
      () => useJobResultData({ job, selectedPlot: "" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.importanceKind).toBe("gain");
    });
  });

  // -------------------------------------------------------------------------
  // Tuning plot (H-0070 fallback)
  // -------------------------------------------------------------------------
  it("fetches tuning plot only for tune jobs", async () => {
    const tuneJob = makeJob({ job_type: "tune" });
    renderHook(() => useJobResultData({ job: tuneJob, selectedPlot: "" }), {
      wrapper,
    });

    await waitFor(() => {
      expect(fetchJobPlot).toHaveBeenCalledWith("j1", "tuning");
    });
  });

  it("does NOT fetch tuning plot for fit jobs", async () => {
    const fitJob = makeJob({ job_type: "fit" });
    renderHook(() => useJobResultData({ job: fitJob, selectedPlot: "" }), {
      wrapper,
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(fetchJobPlot).not.toHaveBeenCalledWith("j1", "tuning");
  });

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------
  it("exposes annotateMetric that injects precision_at_k from config", () => {
    const job = makeJob({
      config: {
        evaluation: {
          metrics: [{ precision_at_k: { k: 10 } } as MetricEntry],
        },
      },
    });
    const { result } = renderHook(
      () => useJobResultData({ job, selectedPlot: "" }),
      { wrapper },
    );
    expect(result.current.annotateMetric("precision_at_k")).toBe(
      "precision_at_k@10",
    );
    expect(result.current.annotateMetric("rmse")).toBe("rmse");
  });

  it("exposes hasFolds derived from fit_result.fold_count", () => {
    const job = makeJob({
      fit_result: {
        metrics: {},
        fold_count: 3,
        params: [],
      },
    });
    const { result } = renderHook(
      () => useJobResultData({ job, selectedPlot: "" }),
      { wrapper },
    );
    expect(result.current.hasFolds).toBe(true);
  });

  it("hasFolds is false for single-fold jobs", () => {
    const job = makeJob({
      fit_result: {
        metrics: {},
        fold_count: 1,
        params: [],
      },
    });
    const { result } = renderHook(
      () => useJobResultData({ job, selectedPlot: "" }),
      { wrapper },
    );
    expect(result.current.hasFolds).toBe(false);
  });
});
