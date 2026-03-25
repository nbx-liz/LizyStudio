import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client";
import {
  fetchBackends,
  fetchColumns,
  fetchConfig,
  fetchConfigDefaults,
  fetchConfigSchema,
  fetchPreview,
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

const mockApiFetch = vi.mocked(apiFetch);

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// loadDataFromPath
// ---------------------------------------------------------------------------
describe("loadDataFromPath", () => {
  it("calls apiFetch with POST and JSON body", async () => {
    mockApiFetch.mockResolvedValue({
      data_ref: { path: "/data/train.csv", shape: [100, 5] },
    });
    await loadDataFromPath("/data/train.csv");
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/data/path", {
      method: "POST",
      body: JSON.stringify({ path: "/data/train.csv" }),
    });
  });
});

// ---------------------------------------------------------------------------
// uploadData
// ---------------------------------------------------------------------------
describe("uploadData", () => {
  it("sends FormData with empty headers override", async () => {
    const file = new File(["content"], "data.csv", { type: "text/csv" });
    mockApiFetch.mockResolvedValue({
      data_ref: { path: "/uploads/data.csv", shape: [10, 3] },
    });
    await uploadData(file);
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/data/upload", {
      method: "POST",
      body: expect.any(FormData),
      headers: {},
    });
    const formData = mockApiFetch.mock.calls[0][1]?.body as FormData;
    expect(formData.get("file")).toBe(file);
  });
});

// ---------------------------------------------------------------------------
// fetchPreview
// ---------------------------------------------------------------------------
describe("fetchPreview", () => {
  it("defaults to 5 rows", async () => {
    mockApiFetch.mockResolvedValue({ columns: [], data: [] });
    await fetchPreview();
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/data/preview?rows=5");
  });

  it("accepts a custom row count", async () => {
    mockApiFetch.mockResolvedValue({ columns: [], data: [] });
    await fetchPreview(10);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/workspace/data/preview?rows=10",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchColumns
// ---------------------------------------------------------------------------
describe("fetchColumns", () => {
  it("calls without params when no target", async () => {
    mockApiFetch.mockResolvedValue({ target: null, columns: [] });
    await fetchColumns();
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/data/columns");
  });

  it("encodes target query param", async () => {
    mockApiFetch.mockResolvedValue({ target: "y", columns: [] });
    await fetchColumns("some col");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/workspace/data/columns?target=some%20col",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchConfigSchema
// ---------------------------------------------------------------------------
describe("fetchConfigSchema", () => {
  it("calls the correct endpoint", async () => {
    mockApiFetch.mockResolvedValue({});
    await fetchConfigSchema();
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/config/schema");
  });
});

// ---------------------------------------------------------------------------
// fetchConfigDefaults
// ---------------------------------------------------------------------------
describe("fetchConfigDefaults", () => {
  it("encodes task and target params", async () => {
    mockApiFetch.mockResolvedValue({});
    await fetchConfigDefaults("classification", "target col");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/workspace/config/defaults?task=classification&target=target%20col",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchConfig
// ---------------------------------------------------------------------------
describe("fetchConfig", () => {
  it("calls without options when none provided", async () => {
    mockApiFetch.mockResolvedValue({});
    await fetchConfig();
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/config", {
      signal: undefined,
    });
  });

  it("passes abort signal", async () => {
    const controller = new AbortController();
    mockApiFetch.mockResolvedValue({});
    await fetchConfig({ signal: controller.signal });
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/config", {
      signal: controller.signal,
    });
  });
});

// ---------------------------------------------------------------------------
// updateConfig
// ---------------------------------------------------------------------------
describe("updateConfig", () => {
  it("sends PUT with JSON body", async () => {
    const config = { task: "classification" };
    mockApiFetch.mockResolvedValue({ config, errors: [] });
    await updateConfig(config);
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/config", {
      method: "PUT",
      body: JSON.stringify(config),
      signal: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------
describe("validateConfig", () => {
  it("sends POST with JSON body", async () => {
    const config = { task: "regression" };
    mockApiFetch.mockResolvedValue({ valid: true, errors: [] });
    await validateConfig(config);
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/config/validate", {
      method: "POST",
      body: JSON.stringify(config),
    });
  });
});

// ---------------------------------------------------------------------------
// uploadConfig
// ---------------------------------------------------------------------------
describe("uploadConfig", () => {
  it("sends FormData with empty headers override", async () => {
    const file = new File(["{}"], "config.yaml", {
      type: "application/x-yaml",
    });
    mockApiFetch.mockResolvedValue({ config: {}, errors: [] });
    await uploadConfig(file);
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/config/upload", {
      method: "POST",
      body: expect.any(FormData),
      headers: {},
    });
    const formData = mockApiFetch.mock.calls[0][1]?.body as FormData;
    expect(formData.get("file")).toBe(file);
  });
});

// ---------------------------------------------------------------------------
// getConfigDownloadUrl
// ---------------------------------------------------------------------------
describe("getConfigDownloadUrl", () => {
  it("returns the correct URL", () => {
    expect(getConfigDownloadUrl()).toBe("/api/workspace/config/download");
  });
});

// ---------------------------------------------------------------------------
// runFit / runTune
// ---------------------------------------------------------------------------
describe("runFit", () => {
  it("sends POST to /workspace/fit", async () => {
    mockApiFetch.mockResolvedValue({ job_id: "j1" });
    await runFit();
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/fit", {
      method: "POST",
    });
  });
});

describe("runTune", () => {
  it("sends POST to /workspace/tune", async () => {
    mockApiFetch.mockResolvedValue({ job_id: "j2" });
    await runTune();
    expect(mockApiFetch).toHaveBeenCalledWith("/workspace/tune", {
      method: "POST",
    });
  });
});

// ---------------------------------------------------------------------------
// fetchBackends / fetchUiSchema
// ---------------------------------------------------------------------------
describe("fetchBackends", () => {
  it("calls /backends", async () => {
    mockApiFetch.mockResolvedValue([]);
    await fetchBackends();
    expect(mockApiFetch).toHaveBeenCalledWith("/backends");
  });
});

describe("fetchUiSchema", () => {
  it("calls /backends/ui-schema", async () => {
    mockApiFetch.mockResolvedValue({});
    await fetchUiSchema();
    expect(mockApiFetch).toHaveBeenCalledWith("/backends/ui-schema");
  });
});
