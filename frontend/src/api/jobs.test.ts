import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client";
import {
  cancelJob,
  deleteJob,
  exportJob,
  fetchJob,
  fetchJobImportance,
  fetchJobImportanceKinds,
  fetchJobLog,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
  fetchJobs,
} from "./jobs";

const mockApiFetch = vi.mocked(apiFetch);

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// fetchJobs
// ---------------------------------------------------------------------------
describe("fetchJobs", () => {
  it("calls /jobs without params when no status", async () => {
    mockApiFetch.mockResolvedValue([]);
    await fetchJobs();
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs");
  });

  it("appends status query param", async () => {
    mockApiFetch.mockResolvedValue([]);
    await fetchJobs("completed");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs?status=completed");
  });
});

// ---------------------------------------------------------------------------
// fetchJob
// ---------------------------------------------------------------------------
describe("fetchJob", () => {
  it("calls /jobs/:id", async () => {
    mockApiFetch.mockResolvedValue({ job_id: "j1" });
    await fetchJob("j1");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1");
  });
});

// ---------------------------------------------------------------------------
// fetchJobImportance
// ---------------------------------------------------------------------------
describe("fetchJobImportance", () => {
  it("uses default kind", async () => {
    mockApiFetch.mockResolvedValue({});
    await fetchJobImportance("j1");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/jobs/j1/importance?kind=default",
    );
  });

  it("accepts custom kind", async () => {
    mockApiFetch.mockResolvedValue({});
    await fetchJobImportance("j1", "shap");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/importance?kind=shap");
  });
});

// ---------------------------------------------------------------------------
// fetchJobImportanceKinds
// ---------------------------------------------------------------------------
describe("fetchJobImportanceKinds", () => {
  it("calls /jobs/:id/importance-kinds", async () => {
    mockApiFetch.mockResolvedValue(["split", "gain", "shap"]);
    const result = await fetchJobImportanceKinds("j1");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/importance-kinds");
    expect(result).toEqual(["split", "gain", "shap"]);
  });
});

// ---------------------------------------------------------------------------
// fetchJobPlot
// ---------------------------------------------------------------------------
describe("fetchJobPlot", () => {
  it("calls /jobs/:id/plot/:type", async () => {
    mockApiFetch.mockResolvedValue({ plotly_json: "{}" });
    await fetchJobPlot("j1", "roc-curve");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/plot/roc-curve");
  });
});

// ---------------------------------------------------------------------------
// fetchJobPlots
// ---------------------------------------------------------------------------
describe("fetchJobPlots", () => {
  it("calls /jobs/:id/plots", async () => {
    mockApiFetch.mockResolvedValue(["learning-curve", "roc-curve"]);
    await fetchJobPlots("j1");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/plots");
  });
});

// ---------------------------------------------------------------------------
// fetchJobSplitSummary
// ---------------------------------------------------------------------------
describe("fetchJobSplitSummary", () => {
  it("calls /jobs/:id/split-summary", async () => {
    mockApiFetch.mockResolvedValue([]);
    await fetchJobSplitSummary("j1");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/split-summary");
  });
});

// ---------------------------------------------------------------------------
// fetchJobLog
// ---------------------------------------------------------------------------
describe("fetchJobLog", () => {
  it("calls /jobs/:id/log", async () => {
    mockApiFetch.mockResolvedValue({ log: "some log" });
    await fetchJobLog("j1");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/log");
  });
});

// ---------------------------------------------------------------------------
// cancelJob
// ---------------------------------------------------------------------------
describe("cancelJob", () => {
  it("sends POST to /jobs/:id/cancel", async () => {
    mockApiFetch.mockResolvedValue({ status: "cancelled" });
    await cancelJob("j1");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/cancel", {
      method: "POST",
    });
  });
});

// ---------------------------------------------------------------------------
// deleteJob
// ---------------------------------------------------------------------------
describe("deleteJob", () => {
  it("sends DELETE to /jobs/:id", async () => {
    mockApiFetch.mockResolvedValue({ status: "deleted" });
    await deleteJob("j1");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1", {
      method: "DELETE",
    });
  });
});

// ---------------------------------------------------------------------------
// exportJob
// ---------------------------------------------------------------------------
describe("exportJob", () => {
  it("sends POST with export_type and output_path", async () => {
    mockApiFetch.mockResolvedValue({
      exported_path: "/out/model.pkl",
      export_type: "model",
    });
    await exportJob("j1", "model", "/out");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/export", {
      method: "POST",
      body: JSON.stringify({ export_type: "model", output_path: "/out" }),
    });
  });

  it("handles report export type", async () => {
    mockApiFetch.mockResolvedValue({
      exported_path: "/out/report.html",
      export_type: "report",
    });
    await exportJob("j1", "report", "/reports");
    expect(mockApiFetch).toHaveBeenCalledWith("/jobs/j1/export", {
      method: "POST",
      body: JSON.stringify({
        export_type: "report",
        output_path: "/reports",
      }),
    });
  });
});
