import { apiClient } from "./client";
import type { components } from "./generated/schema";
import type {
  BackendInfo,
  ColumnStatsResponse,
  ColumnsResponse,
  ConfigError,
  ConfigUpdateResponse,
  PreviewResponse,
  SplitPreviewResponse,
  UiSchema,
} from "./types";

function unwrap<T>(data: T | undefined, endpoint: string): T {
  if (!data) {
    throw new Error(`apiClient returned no data for ${endpoint}`);
  }
  return data;
}

export async function loadDataFromPath(
  path: string,
): Promise<{ data_ref: { path: string; shape: [number, number] } }> {
  const { data } = await apiClient.POST("/api/workspace/data/path", {
    body: { path },
  });
  // SSOT-EXEMPT (Issue #236): backend returns DataLoadResponse but the narrow
  // consumer interface uses an inline subset; the generated shape is wider.
  return unwrap(data, "/api/workspace/data/path") as unknown as {
    data_ref: { path: string; shape: [number, number] };
  };
}

export async function uploadData(
  file: File,
): Promise<{ data_ref: { path: string; shape: [number, number] } }> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.POST("/api/workspace/data/upload", {
    // SSOT-EXEMPT (Issue #236): openapi-fetch's FormData bodySerializer
    // pattern — the two casts let the browser generate the multipart
    // boundary instead of JSON.stringify-ing the FormData.
    body: formData as unknown as components["schemas"]["Body_data_upload_api_workspace_data_upload_post"],
    bodySerializer: (body) => body as unknown as BodyInit,
  });
  // SSOT-EXEMPT (Issue #236): inline subset of DataLoadResponse.
  return unwrap(data, "/api/workspace/data/upload") as unknown as {
    data_ref: { path: string; shape: [number, number] };
  };
}

export async function fetchPreview(rows = 5): Promise<PreviewResponse> {
  const { data } = await apiClient.GET("/api/workspace/data/preview", {
    params: { query: { rows } },
  });
  return unwrap(data, "/api/workspace/data/preview") as PreviewResponse;
}

export async function fetchColumns(target?: string): Promise<ColumnsResponse> {
  const { data } = await apiClient.GET("/api/workspace/data/columns", {
    params: { query: target ? { target } : {} },
  });
  return unwrap(data, "/api/workspace/data/columns") as ColumnsResponse;
}

export async function fetchColumnStats(
  col: string,
  topN = 20,
): Promise<ColumnStatsResponse> {
  const { data } = await apiClient.GET(
    "/api/workspace/data/column-stats/{col}",
    {
      params: { path: { col }, query: { top_n: topN } },
    },
  );
  // SSOT-EXEMPT (Issue #236): ColumnStatsResponse is the backend Pydantic
  // model; generated type differs in Optional/None handling only.
  return unwrap(
    data,
    "/api/workspace/data/column-stats/{col}",
  ) as unknown as ColumnStatsResponse;
}

export async function fetchSplitPreview(): Promise<SplitPreviewResponse> {
  const { data } = await apiClient.GET("/api/workspace/data/split-preview", {});
  return unwrap(
    data,
    "/api/workspace/data/split-preview",
  ) as SplitPreviewResponse;
}

export async function fetchConfigSchema(): Promise<Record<string, unknown>> {
  const { data } = await apiClient.GET("/api/workspace/config/schema", {});
  return unwrap(data, "/api/workspace/config/schema") as Record<
    string,
    unknown
  >;
}

export async function fetchConfigDefaults(
  task: string,
  target: string,
): Promise<Record<string, unknown>> {
  const { data } = await apiClient.GET("/api/workspace/config/defaults", {
    params: { query: { task, target } },
  });
  return unwrap(data, "/api/workspace/config/defaults") as Record<
    string,
    unknown
  >;
}

export async function fetchConfig(opts?: {
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const { data } = await apiClient.GET("/api/workspace/config", {
    signal: opts?.signal,
  });
  return unwrap(data, "/api/workspace/config") as Record<string, unknown>;
}

export async function updateConfig(
  config: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<ConfigUpdateResponse> {
  const { data } = await apiClient.PUT("/api/workspace/config", {
    body: config,
    signal: opts?.signal,
  });
  // SSOT-EXEMPT (Issue #236): ConfigUpdateResponse mirrors the backend model;
  // cast needed to align optional/null handling with the hand-written narrow type.
  return unwrap(
    data,
    "/api/workspace/config (PUT)",
  ) as unknown as ConfigUpdateResponse;
}

export async function validateConfig(
  config: Record<string, unknown>,
): Promise<{ valid: boolean; errors: ConfigError[] }> {
  const { data } = await apiClient.POST("/api/workspace/config/validate", {
    body: config,
  });
  // SSOT-EXEMPT (Issue #236): backend returns ValidationResponse; the narrow
  // consumer interface pins errors to ConfigError[].
  return unwrap(data, "/api/workspace/config/validate") as unknown as {
    valid: boolean;
    errors: ConfigError[];
  };
}

export async function uploadConfig(file: File): Promise<ConfigUpdateResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.POST("/api/workspace/config/upload", {
    // SSOT-EXEMPT (Issue #236): FormData bodySerializer pattern, same as uploadData.
    body: formData as unknown as components["schemas"]["Body_config_upload_api_workspace_config_upload_post"],
    bodySerializer: (body) => body as unknown as BodyInit,
  });
  // SSOT-EXEMPT (Issue #236): same reason as updateConfig.
  return unwrap(
    data,
    "/api/workspace/config/upload",
  ) as unknown as ConfigUpdateResponse;
}

// Pure URL builder, not routed through apiClient. The anchor ``href`` is
// what the UI consumes — there is no response body to type.
export function getConfigDownloadUrl(): string {
  return "/api/workspace/config/download";
}

export async function runFit(): Promise<{ job_id: string }> {
  const { data } = await apiClient.POST("/api/workspace/fit", {});
  // SSOT-EXEMPT (Issue #236): backend returns JobStartResponse — wider than this subset.
  return unwrap(data, "/api/workspace/fit") as unknown as { job_id: string };
}

export async function runTune(): Promise<{ job_id: string }> {
  const { data } = await apiClient.POST("/api/workspace/tune", {});
  // SSOT-EXEMPT (Issue #236): same as runFit.
  return unwrap(data, "/api/workspace/tune") as unknown as { job_id: string };
}

export async function fetchBackends(): Promise<BackendInfo[]> {
  const { data } = await apiClient.GET("/api/backends", {});
  return unwrap(data, "/api/backends") as BackendInfo[];
}

export async function fetchUiSchema(): Promise<UiSchema> {
  const { data } = await apiClient.GET("/api/backends/ui-schema", {});
  return unwrap(data, "/api/backends/ui-schema") as UiSchema;
}
