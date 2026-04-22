/**
 * API error handling tests — verify that API functions propagate errors.
 *
 * All blocks are MSW-driven after Phase 4: both workspace.ts and jobs.ts
 * now route through ``apiClient``, so the legacy ``vi.mock("./client")``
 * override is no longer needed. The suite now exercises the throw-on-
 * error middleware end-to-end for every migrated fetcher.
 */
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/mocks/server";
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

afterEach(() => {
  vi.clearAllMocks();
});

// --- Workspace API error propagation (MSW-driven after Phase 3) ---

describe("workspace API error propagation", () => {
  function errorHandler(path: string, method: "get" | "post" | "put") {
    return http[method](path, () =>
      HttpResponse.json({ detail: "bad request" }, { status: 400 }),
    );
  }

  it("loadDataFromPath rejects on error", async () => {
    server.use(errorHandler("/api/workspace/data/path", "post"));
    await expect(loadDataFromPath("/bad/path")).rejects.toThrow(
      "API error 400",
    );
  });

  it("uploadData rejects on error", async () => {
    server.use(errorHandler("/api/workspace/data/upload", "post"));
    const file = new File(["x"], "data.csv");
    await expect(uploadData(file)).rejects.toThrow("API error 400");
  });

  it("fetchPreview rejects on error", async () => {
    server.use(errorHandler("/api/workspace/data/preview", "get"));
    await expect(fetchPreview()).rejects.toThrow("API error 400");
  });

  it("fetchColumns rejects on error", async () => {
    server.use(errorHandler("/api/workspace/data/columns", "get"));
    await expect(fetchColumns()).rejects.toThrow("API error 400");
  });

  it("fetchConfig rejects on error", async () => {
    server.use(errorHandler("/api/workspace/config", "get"));
    await expect(fetchConfig()).rejects.toThrow("API error 400");
  });

  it("fetchConfigDefaults rejects on error", async () => {
    server.use(errorHandler("/api/workspace/config/defaults", "get"));
    await expect(fetchConfigDefaults("binary", "target")).rejects.toThrow(
      "API error 400",
    );
  });

  it("updateConfig rejects on error", async () => {
    server.use(errorHandler("/api/workspace/config", "put"));
    await expect(updateConfig({ task: "binary" })).rejects.toThrow(
      "API error 400",
    );
  });

  it("validateConfig rejects on error", async () => {
    server.use(errorHandler("/api/workspace/config/validate", "post"));
    await expect(validateConfig({ task: "binary" })).rejects.toThrow(
      "API error 400",
    );
  });

  it("runFit rejects on error", async () => {
    server.use(errorHandler("/api/workspace/fit", "post"));
    await expect(runFit()).rejects.toThrow("API error 400");
  });

  it("runTune rejects on error", async () => {
    server.use(errorHandler("/api/workspace/tune", "post"));
    await expect(runTune()).rejects.toThrow("API error 400");
  });
});

// --- Jobs API error propagation (MSW-driven after Phase 4) ---

describe("jobs API error propagation", () => {
  function jobsErrorHandler(path: string, method: "get" | "post" | "delete") {
    return http[method](path, () =>
      HttpResponse.json({ detail: "server error" }, { status: 500 }),
    );
  }

  it("fetchJobs rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/", "get"));
    await expect(fetchJobs()).rejects.toThrow("API error 500");
  });

  it("fetchJob rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId", "get"));
    await expect(fetchJob("job123")).rejects.toThrow("API error 500");
  });

  it("fetchJobImportance rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId/importance", "get"));
    await expect(fetchJobImportance("job123")).rejects.toThrow("API error 500");
  });

  it("fetchJobPlot rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId/plot/:plotType", "get"));
    await expect(fetchJobPlot("job123", "roc")).rejects.toThrow(
      "API error 500",
    );
  });

  it("fetchJobPlots rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId/plots", "get"));
    await expect(fetchJobPlots("job123")).rejects.toThrow("API error 500");
  });

  it("fetchJobSplitSummary rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId/split-summary", "get"));
    await expect(fetchJobSplitSummary("job123")).rejects.toThrow(
      "API error 500",
    );
  });

  it("fetchJobLog rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId/log", "get"));
    await expect(fetchJobLog("job123")).rejects.toThrow("API error 500");
  });

  it("cancelJob rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId/cancel", "post"));
    await expect(cancelJob("job123")).rejects.toThrow("API error 500");
  });

  it("deleteJob rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId", "delete"));
    await expect(deleteJob("job123")).rejects.toThrow("API error 500");
  });

  it("exportJob rejects on error", async () => {
    server.use(jobsErrorHandler("/api/jobs/:jobId/export", "post"));
    await expect(exportJob("job123", "model", "/out")).rejects.toThrow(
      "API error 500",
    );
  });
});
