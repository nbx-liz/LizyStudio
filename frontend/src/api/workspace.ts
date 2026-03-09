/**
 * Workspace Data API client.
 */

import { apiFetch } from "./client";

// --- Types ---

export interface DataRef {
  source_type: "path" | "upload";
  path: string;
  filename: string;
  fingerprint: string;
  shape: [number, number];
}

export interface WorkspaceStatus {
  has_data: boolean;
  has_config: boolean;
  has_result: boolean;
  data_ref: { filename: string; shape: [number, number] } | null;
  current_job_id: string | null;
}

export interface ColumnInfo {
  name: string;
  dtype: string;
  unique_count: number;
  suggested_type: "numeric" | "categorical";
  suggested_excluded: boolean;
  exclude_reason: "id" | "constant" | null;
}

export interface ColumnsResponse {
  target: string | null;
  columns: ColumnInfo[];
}

export interface PreviewResponse {
  columns: string[];
  data: Record<string, unknown>[];
  total_rows: number;
  total_cols: number;
}

// --- API calls ---

export function fetchStatus(): Promise<WorkspaceStatus> {
  return apiFetch<WorkspaceStatus>("/workspace/status");
}

export function resetWorkspace(): Promise<{ status: string }> {
  return apiFetch("/workspace/reset", { method: "POST" });
}

export function loadDataFromPath(
  path: string,
): Promise<{ data_ref: DataRef }> {
  return apiFetch("/workspace/data/path", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function uploadData(
  file: File,
): Promise<{ data_ref: DataRef }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/workspace/data/upload", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export function fetchPreview(
  rows: number = 50,
): Promise<PreviewResponse> {
  return apiFetch(`/workspace/data/preview?rows=${rows}`);
}

export function fetchColumns(
  target?: string,
): Promise<ColumnsResponse> {
  const params = target ? `?target=${encodeURIComponent(target)}` : "";
  return apiFetch(`/workspace/data/columns${params}`);
}

export function fetchDescribe(): Promise<Record<string, unknown>[]> {
  return apiFetch("/workspace/data/describe");
}
