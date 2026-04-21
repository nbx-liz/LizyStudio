import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/mocks/server";
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

afterEach(() => {
  vi.clearAllMocks();
});

// C-6 Phase 2: tests exercise the typed apiClient through MSW rather than
// mocking the client module. Each test captures the outgoing request
// (method, URL, query, body) so we can prove the openapi-fetch builder
// produces the same wire request the hand-rolled ``apiFetch`` did, which
// is the acceptance criterion for a lossless migration.

// ---------------------------------------------------------------------------
// runInference — POST /api/inference/run
// ---------------------------------------------------------------------------
describe("runInference", () => {
  it("sends POST with JSON body and returns typed response", async () => {
    const params = {
      job_id: "j1",
      data: { source_type: "path", path: "/data/test.csv" },
      return_shap: true,
      evaluate: false,
    };
    let capturedBody: unknown = null;
    let capturedMethod = "";
    server.use(
      http.post("/api/inference/run", async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = await request.json();
        return HttpResponse.json({ inf_id: "i1", job_id: "j1" });
      }),
    );

    const result = await runInference(params);
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toEqual(params);
    expect(result).toEqual({ inf_id: "i1", job_id: "j1" });
  });
});

// ---------------------------------------------------------------------------
// uploadInferenceData — POST /api/inference/upload (multipart/form-data)
// ---------------------------------------------------------------------------
describe("uploadInferenceData", () => {
  it("sends the file as multipart/form-data and returns typed response", async () => {
    const file = new File(["data"], "test.csv", { type: "text/csv" });
    let capturedFile: File | null = null;
    let capturedContentType: string | null = null;
    server.use(
      http.post("/api/inference/upload", async ({ request }) => {
        capturedContentType = request.headers.get("content-type");
        const form = await request.formData();
        const f = form.get("file");
        if (f instanceof File) {
          capturedFile = f;
        }
        return HttpResponse.json({
          upload_path: "/tmp/test.csv",
          filename: "test.csv",
        });
      }),
    );

    const result = await uploadInferenceData(file);
    expect(capturedContentType).toMatch(/^multipart\/form-data;/);
    expect(capturedFile).not.toBeNull();
    expect((capturedFile as unknown as File).name).toBe("test.csv");
    expect(result).toEqual({
      upload_path: "/tmp/test.csv",
      filename: "test.csv",
    });
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceHistory — GET /api/inference/history
// ---------------------------------------------------------------------------
describe("fetchInferenceHistory", () => {
  it("omits job_id query param when no jobId given", async () => {
    let capturedQuery: string | null = null;
    server.use(
      http.get("/api/inference/history", ({ request }) => {
        capturedQuery = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    await fetchInferenceHistory();
    expect(capturedQuery).toBe("");
  });

  it("forwards job_id query param", async () => {
    let capturedJobId: string | null = null;
    server.use(
      http.get("/api/inference/history", ({ request }) => {
        capturedJobId = new URL(request.url).searchParams.get("job_id");
        return HttpResponse.json([]);
      }),
    );
    await fetchInferenceHistory("job 1");
    expect(capturedJobId).toBe("job 1");
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceRecord — GET /api/inference/{inf_id}
// ---------------------------------------------------------------------------
describe("fetchInferenceRecord", () => {
  it("interpolates inf_id into the path and sends job_id as query", async () => {
    let capturedPath = "";
    let capturedJobId: string | null = null;
    server.use(
      http.get("/api/inference/:infId", ({ request, params }) => {
        capturedPath = String(params.infId);
        capturedJobId = new URL(request.url).searchParams.get("job_id");
        return HttpResponse.json({ inf_id: "i1" });
      }),
    );
    await fetchInferenceRecord("inf/1", "job/1");
    expect(capturedPath).toBe("inf/1");
    expect(capturedJobId).toBe("job/1");
  });
});

// ---------------------------------------------------------------------------
// fetchInferencePredictions — GET /api/inference/{inf_id}/predictions
// ---------------------------------------------------------------------------
describe("fetchInferencePredictions", () => {
  it("uses default rows=50 and offset=0", async () => {
    let capturedQuery: URLSearchParams | null = null;
    server.use(
      http.get("/api/inference/:infId/predictions", ({ request }) => {
        capturedQuery = new URL(request.url).searchParams;
        return HttpResponse.json({
          columns: [],
          data: [],
          total_rows: 0,
        });
      }),
    );
    await fetchInferencePredictions("i1", "j1");
    const params = capturedQuery as unknown as URLSearchParams;
    expect(params.get("job_id")).toBe("j1");
    expect(params.get("rows")).toBe("50");
    expect(params.get("offset")).toBe("0");
  });

  it("forwards custom rows and offset", async () => {
    let capturedQuery: URLSearchParams | null = null;
    server.use(
      http.get("/api/inference/:infId/predictions", ({ request }) => {
        capturedQuery = new URL(request.url).searchParams;
        return HttpResponse.json({
          columns: [],
          data: [],
          total_rows: 0,
        });
      }),
    );
    await fetchInferencePredictions("i1", "j1", 100, 20);
    const params = capturedQuery as unknown as URLSearchParams;
    expect(params.get("rows")).toBe("100");
    expect(params.get("offset")).toBe("20");
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceMetrics — GET /api/inference/{inf_id}/metrics
// ---------------------------------------------------------------------------
describe("fetchInferenceMetrics", () => {
  it("interpolates inf_id and forwards job_id", async () => {
    let capturedPath = "";
    let capturedJobId: string | null = null;
    server.use(
      http.get("/api/inference/:infId/metrics", ({ request, params }) => {
        capturedPath = String(params.infId);
        capturedJobId = new URL(request.url).searchParams.get("job_id");
        return HttpResponse.json({});
      }),
    );
    await fetchInferenceMetrics("i1", "j1");
    expect(capturedPath).toBe("i1");
    expect(capturedJobId).toBe("j1");
  });
});

// ---------------------------------------------------------------------------
// fetchInferencePlot — GET /api/inference/{inf_id}/plot/{plot_type}
// ---------------------------------------------------------------------------
describe("fetchInferencePlot", () => {
  it("sends both inf_id and plot_type as path params plus job_id query", async () => {
    let capturedInfId = "";
    let capturedPlotType = "";
    let capturedJobId: string | null = null;
    server.use(
      http.get(
        "/api/inference/:infId/plot/:plotType",
        ({ request, params }) => {
          capturedInfId = String(params.infId);
          capturedPlotType = String(params.plotType);
          capturedJobId = new URL(request.url).searchParams.get("job_id");
          return HttpResponse.json({ plotly_json: "{}" });
        },
      ),
    );
    await fetchInferencePlot("i1", "j1", "roc-curve");
    expect(capturedInfId).toBe("i1");
    expect(capturedPlotType).toBe("roc-curve");
    expect(capturedJobId).toBe("j1");
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceShapPlot — reuses /plot/{plot_type} with plot_type=shap-summary
// ---------------------------------------------------------------------------
describe("fetchInferenceShapPlot", () => {
  it("routes through the same /plot path with plot_type=shap-summary", async () => {
    let capturedPlotType = "";
    server.use(
      http.get("/api/inference/:infId/plot/:plotType", ({ params }) => {
        capturedPlotType = String(params.plotType);
        return HttpResponse.json({ plotly_json: "{}" });
      }),
    );
    await fetchInferenceShapPlot("i1", "j1");
    expect(capturedPlotType).toBe("shap-summary");
  });
});

// ---------------------------------------------------------------------------
// fetchInferenceComparison — GET /api/inference/{inf_id}/comparison/{other_inf_id}
// ---------------------------------------------------------------------------
describe("fetchInferenceComparison", () => {
  it("interpolates both inf ids into the path and forwards job_id", async () => {
    let capturedCurrent = "";
    let capturedOther = "";
    let capturedJobId: string | null = null;
    server.use(
      http.get(
        "/api/inference/:infId/comparison/:otherInfId",
        ({ request, params }) => {
          capturedCurrent = String(params.infId);
          capturedOther = String(params.otherInfId);
          capturedJobId = new URL(request.url).searchParams.get("job_id");
          return HttpResponse.json({ current: {}, other: {} });
        },
      ),
    );
    await fetchInferenceComparison("i1", "i2", "j1");
    expect(capturedCurrent).toBe("i1");
    expect(capturedOther).toBe("i2");
    expect(capturedJobId).toBe("j1");
  });
});

// ---------------------------------------------------------------------------
// getInferenceDownloadUrl — pure URL builder, no fetch
// ---------------------------------------------------------------------------
describe("getInferenceDownloadUrl", () => {
  it("returns a URL with both params encoded", () => {
    const url = getInferenceDownloadUrl("inf/1", "job/1");
    expect(url).toBe("/api/inference/inf%2F1/download?job_id=job%2F1");
  });
});
