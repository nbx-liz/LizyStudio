import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/mocks/server";
import {
  cancelJob,
  deleteJob,
  exportJob,
  fetchJob,
  fetchJobImportance,
  fetchJobImportanceKinds,
  fetchJobLearningCurveMetrics,
  fetchJobLineage,
  fetchJobLog,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
  fetchJobs,
  resumeJob,
  retuneJob,
} from "./jobs";

afterEach(() => {
  vi.clearAllMocks();
});

// C-6 Phase 4: MSW-integration style tests matching Phase 1–3. Each test
// captures the outgoing request (method, URL, query, body) so we can
// prove the openapi-fetch builder reproduces the same wire shape the
// hand-rolled ``apiFetch`` produced. The previous ``vi.mock("./client")``
// harness did not cover URL construction since it intercepted at the
// fetcher layer.

// ---------------------------------------------------------------------------
// fetchJobs — GET /api/jobs/ (trailing slash intentional)
// ---------------------------------------------------------------------------
describe("fetchJobs", () => {
  it("omits status when no argument is given", async () => {
    let capturedSearch: string | null = null;
    server.use(
      http.get("/api/jobs/", ({ request }) => {
        capturedSearch = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    await fetchJobs();
    expect(capturedSearch).toBe("");
  });

  it("forwards status as a query param", async () => {
    let capturedStatus: string | null = null;
    server.use(
      http.get("/api/jobs/", ({ request }) => {
        capturedStatus = new URL(request.url).searchParams.get("status");
        return HttpResponse.json([]);
      }),
    );
    await fetchJobs("completed");
    expect(capturedStatus).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// fetchJob — GET /api/jobs/{job_id}
// ---------------------------------------------------------------------------
describe("fetchJob", () => {
  it("interpolates job_id into the path", async () => {
    let capturedId = "";
    server.use(
      http.get("/api/jobs/:jobId", ({ params }) => {
        capturedId = String(params.jobId);
        return HttpResponse.json({ job_id: "j1" });
      }),
    );
    await fetchJob("j1");
    expect(capturedId).toBe("j1");
  });
});

// ---------------------------------------------------------------------------
// fetchJobImportance — GET /api/jobs/{job_id}/importance
// ---------------------------------------------------------------------------
describe("fetchJobImportance", () => {
  it("defaults kind=default and sends job_id in the path", async () => {
    let capturedId = "";
    let capturedKind: string | null = null;
    server.use(
      http.get("/api/jobs/:jobId/importance", ({ request, params }) => {
        capturedId = String(params.jobId);
        capturedKind = new URL(request.url).searchParams.get("kind");
        return HttpResponse.json({});
      }),
    );
    await fetchJobImportance("job 1");
    expect(capturedId).toBe("job 1");
    expect(capturedKind).toBe("default");
  });

  it("forwards a custom kind", async () => {
    let capturedKind: string | null = null;
    server.use(
      http.get("/api/jobs/:jobId/importance", ({ request }) => {
        capturedKind = new URL(request.url).searchParams.get("kind");
        return HttpResponse.json({});
      }),
    );
    await fetchJobImportance("j1", "gain");
    expect(capturedKind).toBe("gain");
  });
});

// ---------------------------------------------------------------------------
// fetchJobImportanceKinds — GET /api/jobs/{job_id}/importance-kinds
// ---------------------------------------------------------------------------
describe("fetchJobImportanceKinds", () => {
  it("GETs the endpoint", async () => {
    let capturedId = "";
    server.use(
      http.get("/api/jobs/:jobId/importance-kinds", ({ params }) => {
        capturedId = String(params.jobId);
        return HttpResponse.json([]);
      }),
    );
    await fetchJobImportanceKinds("j1");
    expect(capturedId).toBe("j1");
  });
});

// ---------------------------------------------------------------------------
// fetchJobLearningCurveMetrics — GET /api/jobs/{job_id}/learning-curve/metrics
// ---------------------------------------------------------------------------
describe("fetchJobLearningCurveMetrics", () => {
  it("GETs the learning-curve/metrics endpoint", async () => {
    let capturedId = "";
    server.use(
      http.get("/api/jobs/:jobId/learning-curve/metrics", ({ params }) => {
        capturedId = String(params.jobId);
        return HttpResponse.json([]);
      }),
    );
    await fetchJobLearningCurveMetrics("j 1");
    expect(capturedId).toBe("j 1");
  });
});

// ---------------------------------------------------------------------------
// fetchJobPlot — GET /api/jobs/{job_id}/plot/{plot_type}
// ---------------------------------------------------------------------------
describe("fetchJobPlot", () => {
  it("omits query when no options given", async () => {
    let capturedSearch: string | null = null;
    server.use(
      http.get("/api/jobs/:jobId/plot/:plotType", ({ request }) => {
        capturedSearch = new URL(request.url).search;
        return HttpResponse.json({ plotly_json: "{}" });
      }),
    );
    await fetchJobPlot("j1", "roc");
    expect(capturedSearch).toBe("");
  });

  it("sends metrics as a comma-joined string when given an array", async () => {
    let capturedMetrics: string | null = null;
    server.use(
      http.get("/api/jobs/:jobId/plot/:plotType", ({ request }) => {
        capturedMetrics = new URL(request.url).searchParams.get("metrics");
        return HttpResponse.json({ plotly_json: "{}" });
      }),
    );
    await fetchJobPlot("j1", "learning-curve", {
      metrics: ["auc", "f1"],
    });
    expect(capturedMetrics).toBe("auc,f1");
  });

  it("passes a single-string metric as-is", async () => {
    let capturedMetrics: string | null = null;
    server.use(
      http.get("/api/jobs/:jobId/plot/:plotType", ({ request }) => {
        capturedMetrics = new URL(request.url).searchParams.get("metrics");
        return HttpResponse.json({ plotly_json: "{}" });
      }),
    );
    await fetchJobPlot("j1", "learning-curve", { metrics: "auc" });
    expect(capturedMetrics).toBe("auc");
  });

  it("sends kind when provided", async () => {
    let capturedKind: string | null = null;
    server.use(
      http.get("/api/jobs/:jobId/plot/:plotType", ({ request }) => {
        capturedKind = new URL(request.url).searchParams.get("kind");
        return HttpResponse.json({ plotly_json: "{}" });
      }),
    );
    await fetchJobPlot("j1", "importance", { kind: "gain" });
    expect(capturedKind).toBe("gain");
  });

  it("interpolates both path params", async () => {
    let capturedId = "";
    let capturedType = "";
    server.use(
      http.get("/api/jobs/:jobId/plot/:plotType", ({ params }) => {
        capturedId = String(params.jobId);
        capturedType = String(params.plotType);
        return HttpResponse.json({ plotly_json: "{}" });
      }),
    );
    await fetchJobPlot("j 1", "roc curve");
    expect(capturedId).toBe("j 1");
    expect(capturedType).toBe("roc curve");
  });
});

// ---------------------------------------------------------------------------
// fetchJobPlots — GET /api/jobs/{job_id}/plots
// ---------------------------------------------------------------------------
describe("fetchJobPlots", () => {
  it("GETs the plots endpoint", async () => {
    let capturedId = "";
    server.use(
      http.get("/api/jobs/:jobId/plots", ({ params }) => {
        capturedId = String(params.jobId);
        return HttpResponse.json([]);
      }),
    );
    await fetchJobPlots("j1");
    expect(capturedId).toBe("j1");
  });
});

// ---------------------------------------------------------------------------
// fetchJobSplitSummary — GET /api/jobs/{job_id}/split-summary
// ---------------------------------------------------------------------------
describe("fetchJobSplitSummary", () => {
  it("GETs the split-summary endpoint", async () => {
    let capturedId = "";
    server.use(
      http.get("/api/jobs/:jobId/split-summary", ({ params }) => {
        capturedId = String(params.jobId);
        return HttpResponse.json([]);
      }),
    );
    await fetchJobSplitSummary("j1");
    expect(capturedId).toBe("j1");
  });
});

// ---------------------------------------------------------------------------
// fetchJobLog — GET /api/jobs/{job_id}/log
// ---------------------------------------------------------------------------
describe("fetchJobLog", () => {
  it("GETs the log endpoint", async () => {
    let capturedId = "";
    server.use(
      http.get("/api/jobs/:jobId/log", ({ params }) => {
        capturedId = String(params.jobId);
        return HttpResponse.json({ log: "hello" });
      }),
    );
    const result = await fetchJobLog("j1");
    expect(capturedId).toBe("j1");
    expect(result).toEqual({ log: "hello" });
  });
});

// ---------------------------------------------------------------------------
// cancelJob — POST /api/jobs/{job_id}/cancel
// ---------------------------------------------------------------------------
describe("cancelJob", () => {
  it("sends POST with no body", async () => {
    let capturedMethod = "";
    let capturedId = "";
    server.use(
      http.post("/api/jobs/:jobId/cancel", ({ request, params }) => {
        capturedMethod = request.method;
        capturedId = String(params.jobId);
        return HttpResponse.json({ status: "cancelling" });
      }),
    );
    const result = await cancelJob("j1");
    expect(capturedMethod).toBe("POST");
    expect(capturedId).toBe("j1");
    expect(result).toEqual({ status: "cancelling" });
  });
});

// ---------------------------------------------------------------------------
// deleteJob — DELETE /api/jobs/{job_id}
// ---------------------------------------------------------------------------
describe("deleteJob", () => {
  it("sends DELETE without cascade by default", async () => {
    let capturedMethod = "";
    let capturedCascade: string | null = null;
    server.use(
      http.delete("/api/jobs/:jobId", ({ request }) => {
        capturedMethod = request.method;
        capturedCascade = new URL(request.url).searchParams.get("cascade");
        return HttpResponse.json({ status: "deleted" });
      }),
    );
    await deleteJob("j1");
    expect(capturedMethod).toBe("DELETE");
    expect(capturedCascade).toBeNull();
  });

  it("sends cascade=true when requested", async () => {
    let capturedCascade: string | null = null;
    server.use(
      http.delete("/api/jobs/:jobId", ({ request }) => {
        capturedCascade = new URL(request.url).searchParams.get("cascade");
        return HttpResponse.json({
          status: "deleted",
          removed_job_ids: ["j1", "j2"],
        });
      }),
    );
    await deleteJob("j1", { cascade: true });
    expect(capturedCascade).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// retuneJob — POST /api/jobs/{job_id}/retune
// ---------------------------------------------------------------------------
describe("retuneJob", () => {
  it("sends POST with RetuneRequest body", async () => {
    let capturedBody: unknown = null;
    let capturedId = "";
    server.use(
      http.post("/api/jobs/:jobId/retune", async ({ request, params }) => {
        capturedBody = await request.json();
        capturedId = String(params.jobId);
        return HttpResponse.json({
          job_id: "child",
          parent_job_id: "parent",
        });
      }),
    );
    const body = {
      n_trials: 20,
      expand_boundary: true,
      boundary_threshold: 0.1,
    };
    const result = await retuneJob("parent", body);
    expect(capturedId).toBe("parent");
    expect(capturedBody).toEqual(body);
    expect(result).toEqual({ job_id: "child", parent_job_id: "parent" });
  });
});

// ---------------------------------------------------------------------------
// resumeJob — POST /api/jobs/{job_id}/resume
// ---------------------------------------------------------------------------
describe("resumeJob", () => {
  it("sends POST with empty body by default", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post("/api/jobs/:jobId/resume", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          job_id: "child",
          parent_job_id: "parent",
        });
      }),
    );
    await resumeJob("parent");
    expect(capturedBody).toEqual({});
  });

  it("sends POST with n_trials when provided", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post("/api/jobs/:jobId/resume", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          job_id: "child",
          parent_job_id: "parent",
        });
      }),
    );
    await resumeJob("parent", { n_trials: 50 });
    expect(capturedBody).toEqual({ n_trials: 50 });
  });
});

// ---------------------------------------------------------------------------
// fetchJobLineage — GET /api/jobs/{job_id}/lineage
// ---------------------------------------------------------------------------
describe("fetchJobLineage", () => {
  it("returns the lineage tree for the given job", async () => {
    let capturedId = "";
    server.use(
      http.get("/api/jobs/:jobId/lineage", ({ params }) => {
        capturedId = String(params.jobId);
        return HttpResponse.json({
          tree: {
            job_id: "root",
            status: "completed",
            job_type: "fit",
            children: [],
          },
        });
      }),
    );
    const result = await fetchJobLineage("root");
    expect(capturedId).toBe("root");
    expect(result.tree.job_id).toBe("root");
  });
});

// ---------------------------------------------------------------------------
// exportJob — POST /api/jobs/{job_id}/export
// ---------------------------------------------------------------------------
describe("exportJob", () => {
  it("sends POST with ExportRequest body", async () => {
    let capturedBody: unknown = null;
    let capturedId = "";
    server.use(
      http.post("/api/jobs/:jobId/export", async ({ request, params }) => {
        capturedBody = await request.json();
        capturedId = String(params.jobId);
        return HttpResponse.json({
          exported_path: "/out/model.pkl",
          export_type: "model",
        });
      }),
    );
    const result = await exportJob("j1", "model", "/out");
    expect(capturedId).toBe("j1");
    expect(capturedBody).toEqual({ export_type: "model", output_path: "/out" });
    expect(result.exported_path).toBe("/out/model.pkl");
  });
});
