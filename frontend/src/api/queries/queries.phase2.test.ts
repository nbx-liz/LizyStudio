/**
 * Contract tests for Phase 2 of B-7 (inference family + files + job
 * re-exports). Mirrors the scope of queries.test.ts.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../queryKeys";
import {
  useFiles,
  useInferenceComparison,
  useInferenceHistory,
  useInferenceMetrics,
  useInferencePlot,
  useInferencePredictions,
  useInferenceRecord,
  useInferenceShap,
  useJobPlots,
} from ".";

vi.mock("@/api/inference", () => ({
  fetchInferenceHistory: vi.fn().mockResolvedValue([]),
  fetchInferenceRecord: vi.fn().mockResolvedValue({}),
  fetchInferencePredictions: vi.fn().mockResolvedValue({ rows: [] }),
  fetchInferenceMetrics: vi.fn().mockResolvedValue({}),
  fetchInferencePlot: vi.fn().mockResolvedValue({ plotly_json: "{}" }),
  fetchInferenceShapPlot: vi.fn().mockResolvedValue({ plotly_json: "{}" }),
  fetchInferenceComparison: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/api/jobs", () => ({
  fetchJobPlots: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/api/files", () => ({
  fetchDirectory: vi.fn().mockResolvedValue({ path: "/", entries: [] }),
}));

import { fetchDirectory } from "@/api/files";
import {
  fetchInferenceComparison,
  fetchInferenceHistory,
  fetchInferenceMetrics,
  fetchInferencePlot,
  fetchInferencePredictions,
  fetchInferenceRecord,
  fetchInferenceShapPlot,
} from "@/api/inference";
import { fetchJobPlots } from "@/api/jobs";

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
// Inference queries
// ---------------------------------------------------------------------------

describe("useInferenceHistory", () => {
  it("is disabled when jobId is null", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useInferenceHistory(null), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchInferenceHistory).not.toHaveBeenCalled();
  });

  it("fetches when jobId is provided and uses the canonical key", async () => {
    const { wrapper, qc } = makeWrapper();
    renderHook(() => useInferenceHistory("j1"), { wrapper });
    await waitFor(() =>
      expect(fetchInferenceHistory).toHaveBeenCalledWith("j1"),
    );
    expect(qc.getQueryData(queryKeys.infHistory("j1"))).toBeDefined();
  });
});

describe("useInferenceRecord", () => {
  it("is disabled until both ids are known", async () => {
    const { wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ infId, jobId }: { infId: string | null; jobId: string | null }) =>
        useInferenceRecord(infId, jobId),
      {
        wrapper,
        initialProps: {
          infId: null as string | null,
          jobId: "j1" as string | null,
        },
      },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchInferenceRecord).not.toHaveBeenCalled();

    rerender({ infId: "inf1", jobId: "j1" });
    await waitFor(() =>
      expect(fetchInferenceRecord).toHaveBeenCalledWith("inf1", "j1"),
    );
  });
});

describe("useInferencePredictions", () => {
  it("translates page into offset", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useInferencePredictions("inf1", "j1", 2), { wrapper });
    await waitFor(() =>
      expect(fetchInferencePredictions).toHaveBeenCalledWith(
        "inf1",
        "j1",
        50,
        100,
      ),
    );
  });
});

describe("useInferenceMetrics", () => {
  it("uses queryKeys.infMetrics", async () => {
    const { wrapper, qc } = makeWrapper();
    renderHook(() => useInferenceMetrics("inf1", "j1"), { wrapper });
    await waitFor(() =>
      expect(fetchInferenceMetrics).toHaveBeenCalledWith("inf1", "j1"),
    );
    expect(qc.getQueryData(queryKeys.infMetrics("inf1", "j1"))).toBeDefined();
  });
});

describe("useInferencePlot", () => {
  it("respects enabled=false", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useInferencePlot("inf1", "j1", "", { enabled: false }), {
      wrapper,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchInferencePlot).not.toHaveBeenCalled();
  });

  it("fetches when enabled (default)", async () => {
    const { wrapper } = makeWrapper();
    renderHook(
      () => useInferencePlot("inf1", "j1", "prediction-distribution"),
      { wrapper },
    );
    await waitFor(() =>
      expect(fetchInferencePlot).toHaveBeenCalledWith(
        "inf1",
        "j1",
        "prediction-distribution",
      ),
    );
  });
});

describe("useInferenceShap", () => {
  it("fetches the shap plot", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useInferenceShap("inf1", "j1"), { wrapper });
    await waitFor(() =>
      expect(fetchInferenceShapPlot).toHaveBeenCalledWith("inf1", "j1"),
    );
  });
});

describe("useInferenceComparison", () => {
  it("is disabled until compareInfId is provided", async () => {
    const { wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ cmp }: { cmp: string | null }) =>
        useInferenceComparison("inf1", cmp, "j1"),
      { wrapper, initialProps: { cmp: null as string | null } },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchInferenceComparison).not.toHaveBeenCalled();

    rerender({ cmp: "inf2" });
    await waitFor(() =>
      expect(fetchInferenceComparison).toHaveBeenCalledWith(
        "inf1",
        "inf2",
        "j1",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// useJobPlots (shared between Workspace results + Jobs inference view)
// ---------------------------------------------------------------------------

describe("useJobPlots", () => {
  it("uses queryKeys.jobPlots as the canonical key", async () => {
    const { wrapper, qc } = makeWrapper();
    renderHook(() => useJobPlots("j1"), { wrapper });
    await waitFor(() => expect(fetchJobPlots).toHaveBeenCalledWith("j1"));
    expect(qc.getQueryData(queryKeys.jobPlots("j1"))).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// useFiles
// ---------------------------------------------------------------------------

describe("useFiles", () => {
  it("is disabled until enabled flips true", async () => {
    const { wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => useFiles("~", { enabled: on }),
      { wrapper, initialProps: { on: false } },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchDirectory).not.toHaveBeenCalled();

    rerender({ on: true });
    await waitFor(() => expect(fetchDirectory).toHaveBeenCalled());
  });

  it("passes undefined to fetchDirectory for the ~ root sentinel", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useFiles("~", { enabled: true }), { wrapper });
    await waitFor(() => expect(fetchDirectory).toHaveBeenCalledWith(undefined));
  });

  it("passes a non-root path through verbatim", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useFiles("/tmp/data", { enabled: true }), { wrapper });
    await waitFor(() =>
      expect(fetchDirectory).toHaveBeenCalledWith("/tmp/data"),
    );
  });
});
