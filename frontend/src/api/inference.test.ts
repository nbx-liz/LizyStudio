import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client";
import {
  fetchInferenceComparison,
  fetchInferenceHistory,
  fetchInferenceMetrics,
  fetchInferencePlot,
  fetchInferencePredictions,
  fetchInferenceRecord,
  fetchInferenceShapPlot,
  getInferenceDownloadUrl,
  runInference,
  uploadInferenceData,
} from "./inference";

const mockApiFetch = vi.mocked(apiFetch);

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// runInference
// ---------------------------------------------------------------------------
describe("runInference", () => {
  it("sends POST with JSON body", async () => {
    const params = {
      job_id: "j1",
      data: { source_type: "path", path: "/data/test.csv" },
      return_shap: true,
      evaluate: false,
    };
    mockApiFetch.mockResolvedValue({ inf_id: "i1", job_id: "j1" });
    await runInference(params);
    expect(mockApiFetch).toHaveBeenCalledWith("/inference/run", {
      method: "POST",
      body: JSON.stringify(params),
    });
  });
});

// ---------------------------------------------------------------------------
// uploadInferenceData
// ---------------------------------------------------------------------------
describe("uploadInferenceData", () => {
  it("sends FormData with empty headers override", async () => {
    const file = new File(["data"], "test.csv", { type: "text/csv" });
    mockApiFetch.mockResolvedValue({
      upload_path: "/tmp/test.csv",
      filename: "test.csv",
    });
    await uploadInferenceData(file);
    expect(mockApiFetch).toHaveBeenCalledWith("/inference/upload", {
      method: "POST",
      body: expect.any(FormData),
      headers: {},
    });
    const formData = mockApiFetch.mock.calls[0][1]?.body as FormData;
    expect(formData.get("file")).toBe(file);
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceHistory
// ---------------------------------------------------------------------------
describe("fetchInferenceHistory", () => {
  it("calls without params when no jobId", async () => {
    mockApiFetch.mockResolvedValue([]);
    await fetchInferenceHistory();
    expect(mockApiFetch).toHaveBeenCalledWith("/inference/history");
  });

  it("encodes job_id query param", async () => {
    mockApiFetch.mockResolvedValue([]);
    await fetchInferenceHistory("job 1");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/inference/history?job_id=job%201",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceRecord
// ---------------------------------------------------------------------------
describe("fetchInferenceRecord", () => {
  it("encodes infId and jobId", async () => {
    mockApiFetch.mockResolvedValue({ inf_id: "i1" });
    await fetchInferenceRecord("inf/1", "job/1");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/inference/inf%2F1?job_id=job%2F1",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchInferencePredictions
// ---------------------------------------------------------------------------
describe("fetchInferencePredictions", () => {
  it("uses default rows and offset", async () => {
    mockApiFetch.mockResolvedValue({ columns: [], data: [], total_rows: 0 });
    await fetchInferencePredictions("i1", "j1");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/inference/i1/predictions?job_id=j1&rows=50&offset=0",
    );
  });

  it("accepts custom rows and offset", async () => {
    mockApiFetch.mockResolvedValue({ columns: [], data: [], total_rows: 0 });
    await fetchInferencePredictions("i1", "j1", 100, 20);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/inference/i1/predictions?job_id=j1&rows=100&offset=20",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceMetrics
// ---------------------------------------------------------------------------
describe("fetchInferenceMetrics", () => {
  it("encodes infId and jobId", async () => {
    mockApiFetch.mockResolvedValue({});
    await fetchInferenceMetrics("i1", "j1");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/inference/i1/metrics?job_id=j1",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchInferencePlot
// ---------------------------------------------------------------------------
describe("fetchInferencePlot", () => {
  it("encodes all path segments", async () => {
    mockApiFetch.mockResolvedValue({ plotly_json: "{}" });
    await fetchInferencePlot("i1", "j1", "roc-curve");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/inference/i1/plot/roc-curve?job_id=j1",
    );
  });
});

// ---------------------------------------------------------------------------
// getInferenceDownloadUrl
// ---------------------------------------------------------------------------
describe("getInferenceDownloadUrl", () => {
  it("returns correct URL with encoded params", () => {
    const url = getInferenceDownloadUrl("inf/1", "job/1");
    expect(url).toBe("/api/inference/inf%2F1/download?job_id=job%2F1");
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceShapPlot
// ---------------------------------------------------------------------------
describe("fetchInferenceShapPlot", () => {
  it("calls shap-summary plot endpoint", async () => {
    mockApiFetch.mockResolvedValue({ plotly_json: "{}" });
    await fetchInferenceShapPlot("i1", "j1");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/inference/i1/plot/shap-summary?job_id=j1",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceComparison
// ---------------------------------------------------------------------------
describe("fetchInferenceComparison", () => {
  it("calls comparison endpoint with correct params", async () => {
    mockApiFetch.mockResolvedValue({ current: {}, other: {} });
    await fetchInferenceComparison("i1", "i2", "j1");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/inference/i1/comparison/i2?job_id=j1",
    );
  });
});
