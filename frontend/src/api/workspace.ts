import { apiFetch } from "./client";
import type {
  BackendInfo,
  ColumnsResponse,
  ConfigError,
  ConfigUpdateResponse,
  PreviewResponse,
  WorkspaceStatus,
} from "./types";

export function fetchStatus(): Promise<WorkspaceStatus> {
  return apiFetch("/workspace/status");
}

export function resetWorkspace(): Promise<{ status: string }> {
  return apiFetch("/workspace/reset", { method: "POST" });
}

export function loadDataFromPath(
  path: string,
): Promise<{ data_ref: { path: string; shape: [number, number] } }> {
  return apiFetch("/workspace/data/path", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function uploadData(
  file: File,
): Promise<{ data_ref: { path: string; shape: [number, number] } }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch("/workspace/data/upload", {
    method: "POST",
    body: formData,
    headers: {},
  });
}

export function fetchPreview(rows = 5): Promise<PreviewResponse> {
  return apiFetch(`/workspace/data/preview?rows=${rows}`);
}

export function fetchColumns(target?: string): Promise<ColumnsResponse> {
  const params = target ? `?target=${encodeURIComponent(target)}` : "";
  return apiFetch(`/workspace/data/columns${params}`);
}

export function fetchConfigSchema(): Promise<Record<string, unknown>> {
  return apiFetch("/workspace/config/schema");
}

export function fetchConfigDefaults(
  task: string,
  target: string,
): Promise<Record<string, unknown>> {
  return apiFetch(
    `/workspace/config/defaults?task=${encodeURIComponent(task)}&target=${encodeURIComponent(target)}`,
  );
}

export function fetchConfig(): Promise<Record<string, unknown>> {
  return apiFetch("/workspace/config");
}

export function updateConfig(
  config: Record<string, unknown>,
): Promise<ConfigUpdateResponse> {
  return apiFetch("/workspace/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export function validateConfig(
  config: Record<string, unknown>,
): Promise<{ valid: boolean; errors: ConfigError[] }> {
  return apiFetch("/workspace/config/validate", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export function uploadConfig(file: File): Promise<ConfigUpdateResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch("/workspace/config/upload", {
    method: "POST",
    body: formData,
    headers: {},
  });
}

export function getConfigDownloadUrl(): string {
  return "/api/workspace/config/download";
}

export function runFit(): Promise<{ job_id: string }> {
  return apiFetch("/workspace/fit", { method: "POST" });
}

export function runTune(): Promise<{ job_id: string }> {
  return apiFetch("/workspace/tune", { method: "POST" });
}

export function fetchBackends(): Promise<BackendInfo[]> {
  return apiFetch("/backends");
}
