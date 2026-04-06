/**
 * API error handling tests — verify that API functions propagate errors
 * correctly when apiFetch rejects.
 */
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
  fetchJobLog,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
  fetchJobs,
} from "./jobs";
import {
  fetchColumns,
  fetchConfig,
  fetchConfigDefaults,
  fetchPreview,
  loadDataFromPath,
  runFit,
  runTune,
  updateConfig,
  uploadData,
  validateConfig,
} from "./workspace";

const mockApiFetch = vi.mocked(apiFetch);

afterEach(() => {
  vi.clearAllMocks();
});

// --- Workspace API error propagation ---

describe("workspace API error propagation", () => {
  const apiError = new Error("API error 400");

  it("loadDataFromPath rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(loadDataFromPath("/bad/path")).rejects.toThrow(
      "API error 400",
    );
  });

  it("uploadData rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    const file = new File(["x"], "data.csv");
    await expect(uploadData(file)).rejects.toThrow("API error 400");
  });

  it("fetchPreview rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchPreview()).rejects.toThrow("API error 400");
  });

  it("fetchColumns rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchColumns()).rejects.toThrow("API error 400");
  });

  it("fetchConfig rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchConfig()).rejects.toThrow("API error 400");
  });

  it("fetchConfigDefaults rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchConfigDefaults("binary", "target")).rejects.toThrow(
      "API error 400",
    );
  });

  it("updateConfig rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(updateConfig({ task: "binary" })).rejects.toThrow(
      "API error 400",
    );
  });

  it("validateConfig rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(validateConfig({ task: "binary" })).rejects.toThrow(
      "API error 400",
    );
  });

  it("runFit rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(runFit()).rejects.toThrow("API error 400");
  });

  it("runTune rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(runTune()).rejects.toThrow("API error 400");
  });
});

// --- Jobs API error propagation ---

describe("jobs API error propagation", () => {
  const apiError = new Error("API error 500");

  it("fetchJobs rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchJobs()).rejects.toThrow("API error 500");
  });

  it("fetchJob rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchJob("job123")).rejects.toThrow("API error 500");
  });

  it("fetchJobImportance rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchJobImportance("job123")).rejects.toThrow("API error 500");
  });

  it("fetchJobPlot rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchJobPlot("job123", "roc")).rejects.toThrow(
      "API error 500",
    );
  });

  it("fetchJobPlots rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchJobPlots("job123")).rejects.toThrow("API error 500");
  });

  it("fetchJobSplitSummary rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchJobSplitSummary("job123")).rejects.toThrow(
      "API error 500",
    );
  });

  it("fetchJobLog rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(fetchJobLog("job123")).rejects.toThrow("API error 500");
  });

  it("cancelJob rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(cancelJob("job123")).rejects.toThrow("API error 500");
  });

  it("deleteJob rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(deleteJob("job123")).rejects.toThrow("API error 500");
  });

  it("exportJob rejects on error", async () => {
    mockApiFetch.mockRejectedValue(apiError);
    await expect(exportJob("job123", "model", "/out")).rejects.toThrow(
      "API error 500",
    );
  });
});
