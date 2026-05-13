import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/mocks/server";
import {
  fetchBackends,
  fetchColumnStats,
  fetchColumns,
  fetchConfig,
  fetchConfigDefaults,
  fetchConfigSchema,
  fetchPreview,
  fetchSplitPreview,
  fetchUiSchema,
  getConfigDownloadUrl,
  loadDataFromPath,
  runFit,
  runTune,
  updateConfig,
  uploadConfig,
  uploadData,
  validateConfig,
} from "./workspace";

afterEach(() => {
  vi.clearAllMocks();
});

// C-6 Phase 3: tests exercise the typed apiClient through MSW rather than
// mocking the client module, matching the Phase 1/2 pattern. Each test
// captures the outgoing request (method, URL, query, body) so the
// openapi-fetch builder is proven to produce the same wire-level shape
// that the hand-rolled ``apiFetch`` did.

// ---------------------------------------------------------------------------
// loadDataFromPath — POST /api/workspace/data/path
// ---------------------------------------------------------------------------
describe("loadDataFromPath", () => {
  it("sends POST with the path field in a JSON body", async () => {
    let capturedBody: unknown = null;
    let capturedMethod = "";
    server.use(
      http.post("/api/workspace/data/path", async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = await request.json();
        return HttpResponse.json({
          data_ref: { path: "/data/train.csv", shape: [100, 5] },
        });
      }),
    );

    const result = await loadDataFromPath("/data/train.csv");
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toEqual({ path: "/data/train.csv" });
    expect(result.data_ref.shape).toEqual([100, 5]);
  });
});

// ---------------------------------------------------------------------------
// uploadData — POST /api/workspace/data/upload (multipart/form-data)
// ---------------------------------------------------------------------------
describe("uploadData", () => {
  it("sends the file as multipart/form-data", async () => {
    const file = new File(["content"], "data.csv", { type: "text/csv" });
    let capturedContentType: string | null = null;
    let capturedFile: File | null = null;
    server.use(
      http.post("/api/workspace/data/upload", async ({ request }) => {
        capturedContentType = request.headers.get("content-type");
        const form = await request.formData();
        const f = form.get("file");
        if (f instanceof File) {
          capturedFile = f;
        }
        return HttpResponse.json({
          data_ref: { path: "/uploads/data.csv", shape: [10, 3] },
        });
      }),
    );

    await uploadData(file);
    expect(capturedContentType).toMatch(/^multipart\/form-data;/);
    expect(capturedFile).not.toBeNull();
    expect((capturedFile as unknown as File).name).toBe("data.csv");
  });
});

// ---------------------------------------------------------------------------
// fetchPreview — GET /api/workspace/data/preview
// ---------------------------------------------------------------------------
describe("fetchPreview", () => {
  it("defaults to rows=5", async () => {
    let capturedRows: string | null = null;
    server.use(
      http.get("/api/workspace/data/preview", ({ request }) => {
        capturedRows = new URL(request.url).searchParams.get("rows");
        return HttpResponse.json({ columns: [], data: [] });
      }),
    );
    await fetchPreview();
    expect(capturedRows).toBe("5");
  });

  it("forwards a custom rows value", async () => {
    let capturedRows: string | null = null;
    server.use(
      http.get("/api/workspace/data/preview", ({ request }) => {
        capturedRows = new URL(request.url).searchParams.get("rows");
        return HttpResponse.json({ columns: [], data: [] });
      }),
    );
    await fetchPreview(10);
    expect(capturedRows).toBe("10");
  });
});

// ---------------------------------------------------------------------------
// fetchColumns — GET /api/workspace/data/columns
// ---------------------------------------------------------------------------
describe("fetchColumns", () => {
  it("omits target when no argument is given", async () => {
    let capturedSearch: string | null = null;
    server.use(
      http.get("/api/workspace/data/columns", ({ request }) => {
        capturedSearch = new URL(request.url).search;
        return HttpResponse.json({ target: null, columns: [] });
      }),
    );
    await fetchColumns();
    expect(capturedSearch).toBe("");
  });

  it("forwards the target query param", async () => {
    let capturedTarget: string | null = null;
    server.use(
      http.get("/api/workspace/data/columns", ({ request }) => {
        capturedTarget = new URL(request.url).searchParams.get("target");
        return HttpResponse.json({ target: "some col", columns: [] });
      }),
    );
    await fetchColumns("some col");
    expect(capturedTarget).toBe("some col");
  });
});

// ---------------------------------------------------------------------------
// fetchColumnStats — GET /api/workspace/data/column-stats/{col}
// ---------------------------------------------------------------------------
describe("fetchColumnStats", () => {
  it("interpolates col into the path and forwards top_n", async () => {
    let capturedCol = "";
    let capturedTopN: string | null = null;
    server.use(
      http.get(
        "/api/workspace/data/column-stats/:col",
        ({ request, params }) => {
          capturedCol = String(params.col);
          capturedTopN = new URL(request.url).searchParams.get("top_n");
          return HttpResponse.json({
            name: "x",
            dtype: "int",
            unique_count: 0,
            total_count: 0,
            null_count: 0,
            value_counts: [],
          });
        },
      ),
    );
    await fetchColumnStats("my col", 30);
    expect(capturedCol).toBe("my col");
    expect(capturedTopN).toBe("30");
  });
});

// ---------------------------------------------------------------------------
// fetchSplitPreview — GET /api/workspace/data/split-preview
// ---------------------------------------------------------------------------
describe("fetchSplitPreview", () => {
  it("GETs the split-preview endpoint", async () => {
    let called = false;
    server.use(
      http.get("/api/workspace/data/split-preview", () => {
        called = true;
        return HttpResponse.json({ folds: [], strategy: "holdout" });
      }),
    );
    await fetchSplitPreview();
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchConfigSchema — GET /api/workspace/config/schema
// ---------------------------------------------------------------------------
describe("fetchConfigSchema", () => {
  it("GETs the schema endpoint", async () => {
    let called = false;
    server.use(
      http.get("/api/workspace/config/schema", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    await fetchConfigSchema();
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchConfigDefaults — GET /api/workspace/config/defaults
// ---------------------------------------------------------------------------
describe("fetchConfigDefaults", () => {
  it("sends task and target as query params", async () => {
    let capturedTask: string | null = null;
    let capturedTarget: string | null = null;
    server.use(
      http.get("/api/workspace/config/defaults", ({ request }) => {
        const url = new URL(request.url);
        capturedTask = url.searchParams.get("task");
        capturedTarget = url.searchParams.get("target");
        return HttpResponse.json({});
      }),
    );
    await fetchConfigDefaults("classification", "target col");
    expect(capturedTask).toBe("classification");
    expect(capturedTarget).toBe("target col");
  });
});

// ---------------------------------------------------------------------------
// fetchConfig — GET /api/workspace/config (with optional AbortSignal)
// ---------------------------------------------------------------------------
describe("fetchConfig", () => {
  it("GETs the config endpoint with no signal", async () => {
    let called = false;
    server.use(
      http.get("/api/workspace/config", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    await fetchConfig();
    expect(called).toBe(true);
  });

  it("forwards a pre-aborted signal so fetch rejects immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    server.use(http.get("/api/workspace/config", () => HttpResponse.json({})));
    await expect(fetchConfig({ signal: controller.signal })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateConfig — PUT /api/workspace/config
// ---------------------------------------------------------------------------
describe("updateConfig", () => {
  it("sends PUT with JSON body and returns the updated config", async () => {
    const config = { task: "classification" };
    let capturedMethod = "";
    let capturedBody: unknown = null;
    server.use(
      http.put("/api/workspace/config", async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = await request.json();
        return HttpResponse.json({ config, errors: [] });
      }),
    );
    const result = await updateConfig(config);
    expect(capturedMethod).toBe("PUT");
    expect(capturedBody).toEqual(config);
    expect(result.config).toEqual(config);
  });

  it("forwards a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    server.use(
      http.put("/api/workspace/config", () =>
        HttpResponse.json({ config: {}, errors: [] }),
      ),
    );
    await expect(
      updateConfig({ task: "x" }, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateConfig — POST /api/workspace/config/validate
// ---------------------------------------------------------------------------
describe("validateConfig", () => {
  it("sends POST with JSON body", async () => {
    const config = { task: "regression" };
    let capturedBody: unknown = null;
    server.use(
      http.post("/api/workspace/config/validate", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ valid: true, errors: [] });
      }),
    );
    const result = await validateConfig(config);
    expect(capturedBody).toEqual(config);
    expect(result).toEqual({ valid: true, errors: [] });
  });
});

// ---------------------------------------------------------------------------
// uploadConfig — POST /api/workspace/config/upload (multipart/form-data)
// ---------------------------------------------------------------------------
describe("uploadConfig", () => {
  it("sends the file as multipart/form-data", async () => {
    const file = new File(["{}"], "config.yaml", {
      type: "application/x-yaml",
    });
    let capturedContentType: string | null = null;
    let capturedFile: File | null = null;
    server.use(
      http.post("/api/workspace/config/upload", async ({ request }) => {
        capturedContentType = request.headers.get("content-type");
        const form = await request.formData();
        const f = form.get("file");
        if (f instanceof File) {
          capturedFile = f;
        }
        return HttpResponse.json({ config: {}, errors: [] });
      }),
    );
    await uploadConfig(file);
    expect(capturedContentType).toMatch(/^multipart\/form-data;/);
    expect(capturedFile).not.toBeNull();
    expect((capturedFile as unknown as File).name).toBe("config.yaml");
  });
});

// ---------------------------------------------------------------------------
// getConfigDownloadUrl — pure URL builder
// ---------------------------------------------------------------------------
describe("getConfigDownloadUrl", () => {
  it("returns the download URL", () => {
    expect(getConfigDownloadUrl()).toBe("/api/workspace/config/download");
  });
});

// ---------------------------------------------------------------------------
// runFit / runTune — POST /api/workspace/fit and /tune
// ---------------------------------------------------------------------------
describe("runFit", () => {
  it("sends POST and returns the job_id", async () => {
    server.use(
      http.post("/api/workspace/fit", () =>
        HttpResponse.json({ job_id: "j1" }),
      ),
    );
    const result = await runFit();
    expect(result).toEqual({ job_id: "j1" });
  });

  it("sends no body when called with no argument (P-0086)", async () => {
    let capturedBody: unknown = "not captured";
    server.use(
      http.post("/api/workspace/fit", async ({ request }) => {
        capturedBody = await request
          .clone()
          .json()
          .catch(() => "empty");
        return HttpResponse.json({ job_id: "j1" });
      }),
    );
    await runFit();
    expect(capturedBody).toBe("empty");
  });

  it("sends body={config} when called with config (P-0086)", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post("/api/workspace/fit", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ job_id: "j1" });
      }),
    );
    const config = { task: "binary", features: { exclude: ["age"] } };
    await runFit(config);
    expect(capturedBody).toEqual({ config });
  });
});

describe("runTune", () => {
  it("sends POST and returns the job_id", async () => {
    server.use(
      http.post("/api/workspace/tune", () =>
        HttpResponse.json({ job_id: "j2" }),
      ),
    );
    const result = await runTune();
    expect(result).toEqual({ job_id: "j2" });
  });

  it("sends body={config} when called with config (P-0086)", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post("/api/workspace/tune", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ job_id: "j2" });
      }),
    );
    const config = { task: "regression", features: { exclude: ["x"] } };
    await runTune(config);
    expect(capturedBody).toEqual({ config });
  });
});

// ---------------------------------------------------------------------------
// fetchBackends / fetchUiSchema — GET /api/backends and /backends/ui-schema
// ---------------------------------------------------------------------------
describe("fetchBackends", () => {
  it("GETs /api/backends", async () => {
    let called = false;
    server.use(
      http.get("/api/backends", () => {
        called = true;
        return HttpResponse.json([]);
      }),
    );
    await fetchBackends();
    expect(called).toBe(true);
  });
});

describe("fetchUiSchema", () => {
  it("GETs /api/backends/ui-schema", async () => {
    let called = false;
    server.use(
      http.get("/api/backends/ui-schema", () => {
        called = true;
        return HttpResponse.json({
          sections: [],
          option_sets: {
            objective: {},
            metric: {},
            eval_metric: {},
          },
          parameter_hints: [],
          search_space_catalog: [],
          step_map: {},
          conditional_visibility: {},
          defaults: {},
          inner_valid_options: [],
          n_trials_presets: [],
          capabilities: {
            cv_strategies: [],
            tune: { allow_empty_space: true },
          },
          calibration_methods: [],
          additional_params: [],
        });
      }),
    );
    await fetchUiSchema();
    expect(called).toBe(true);
  });
});
