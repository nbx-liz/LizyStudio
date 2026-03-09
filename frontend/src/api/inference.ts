/**
 * Inference API client (H-0003).
 */

import { apiFetch } from "./client";

export interface InferenceRecord {
  inf_id: string;
  job_id: string;
  data_ref: {
    source_type: "path" | "upload";
    path: string;
    filename: string;
    fingerprint: string;
    shape: [number, number];
  };
  has_ground_truth: boolean;
  created_at: string;
  row_count: number;
  warnings: string[];
}

export interface PredictionsPage {
  columns: string[];
  data: Record<string, unknown>[];
  total_rows: number;
}

export function runInference(
  jobId: string,
  dataPath: string,
  returnShap: boolean = false,
  evaluate: boolean = true,
): Promise<{ inf_id: string; job_id: string }> {
  return apiFetch("/inference/run", {
    method: "POST",
    body: JSON.stringify({
      job_id: jobId,
      data: { source_type: "path", path: dataPath },
      return_shap: returnShap,
      evaluate,
    }),
  });
}

export async function uploadInferenceData(
  file: File,
): Promise<{ upload_path: string; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/inference/upload", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export function fetchInferenceHistory(
  jobId?: string,
): Promise<InferenceRecord[]> {
  const params = jobId ? `?job_id=${jobId}` : "";
  return apiFetch(`/inference/history${params}`);
}

export function fetchInference(
  infId: string,
  jobId: string,
): Promise<InferenceRecord> {
  return apiFetch(`/inference/${infId}?job_id=${jobId}`);
}

export function fetchInferencePredictions(
  infId: string,
  jobId: string,
  rows: number = 50,
  offset: number = 0,
): Promise<PredictionsPage> {
  return apiFetch(
    `/inference/${infId}/predictions?job_id=${jobId}&rows=${rows}&offset=${offset}`,
  );
}

export function fetchInferenceMetrics(
  infId: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  return apiFetch(`/inference/${infId}/metrics?job_id=${jobId}`);
}

export function fetchInferencePlot(
  infId: string,
  jobId: string,
  plotType: string,
): Promise<{ plotly_json: string }> {
  return apiFetch(
    `/inference/${infId}/plot/${plotType}?job_id=${jobId}`,
  );
}

export function inferenceDownloadUrl(
  infId: string,
  jobId: string,
): string {
  return `/api/inference/${infId}/download?job_id=${jobId}`;
}

export function fetchInferenceComparison(
  infId: string,
  otherInfId: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  return apiFetch(
    `/inference/${infId}/comparison/${otherInfId}?job_id=${jobId}`,
  );
}
