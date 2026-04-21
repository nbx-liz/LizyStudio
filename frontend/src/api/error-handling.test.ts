/**
 * API error handling tests — verify that API functions propagate errors.
 *
 * Workspace block uses MSW (C-6 Phase 3 migration: workspace.ts calls
 * ``apiClient`` so the legacy ``vi.mock("./client")`` override no longer
 * intercepts its requests). Jobs block stays on ``vi.mock`` until Phase 4
 * migrates ``jobs.ts``, at which point the same rewrite applies.
 */
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/mocks/server";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, apiFetch: vi.fn() };
});

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
