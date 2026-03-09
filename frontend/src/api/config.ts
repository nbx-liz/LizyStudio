/**
 * Config API client.
 */

import { apiFetch } from "./client";

export interface ConfigUpdateResponse {
  config: Record<string, unknown>;
  errors: Array<Record<string, unknown>>;
}

export function fetchConfigSchema(): Promise<Record<string, unknown>> {
  return apiFetch("/workspace/config/schema");
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
): Promise<{ valid: boolean; errors: Array<Record<string, unknown>> }> {
  return apiFetch("/workspace/config/validate", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function uploadConfig(
  file: File,
): Promise<ConfigUpdateResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/workspace/config/upload", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export function downloadConfigUrl(): string {
  return "/api/workspace/config/download";
}
