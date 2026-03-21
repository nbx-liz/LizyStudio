import { apiFetch } from "./client";

// --- Types ---

export interface InferenceRecord {
  inf_id: string;
  job_id: string;
  data_ref: {
    source_type: string;
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

export interface PredictionsResponse {
  columns: string[];
  data: Record<string, unknown>[];
  total_rows: number;
}

export interface ComparisonStats {
  current: Record<string, number>;
  other: Record<string, number>;
  current_proba?: Record<string, number>;
  other_proba?: Record<string, number>;
}

// --- Run ---

export function runInference(params: {
  job_id: string;
  data: { source_type: string; path: string };
  return_shap: boolean;
  evaluate: boolean;
}): Promise<{ inf_id: string; job_id: string }> {
  return apiFetch("/inference/run", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function uploadInferenceData(
  file: File,
): Promise<{ upload_path: string; filename: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch("/inference/upload", {
    method: "POST",
    body: formData,
    headers: {},
  });
}

// --- Query ---

export function fetchInferenceHistory(
  jobId?: string,
): Promise<InferenceRecord[]> {
  const params = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
  return apiFetch(`/inference/history${params}`);
}

export function fetchInferenceRecord(
  infId: string,
  jobId: string,
): Promise<InferenceRecord> {
  const eid = encodeURIComponent(infId);
  return apiFetch(`/inference/${eid}?job_id=${encodeURIComponent(jobId)}`);
}

export function fetchInferencePredictions(
  infId: string,
  jobId: string,
  rows = 50,
  offset = 0,
): Promise<PredictionsResponse> {
  const eid = encodeURIComponent(infId);
  return apiFetch(
    `/inference/${eid}/predictions?job_id=${encodeURIComponent(jobId)}&rows=${rows}&offset=${offset}`,
  );
}

export function fetchInferenceMetrics(
  infId: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  const eid = encodeURIComponent(infId);
  return apiFetch(
    `/inference/${eid}/metrics?job_id=${encodeURIComponent(jobId)}`,
  );
}

export function fetchInferencePlot(
  infId: string,
  jobId: string,
  plotType: string,
): Promise<{ plotly_json: string }> {
  const eid = encodeURIComponent(infId);
  return apiFetch(
    `/inference/${eid}/plot/${encodeURIComponent(plotType)}?job_id=${encodeURIComponent(jobId)}`,
  );
}

export function getInferenceDownloadUrl(infId: string, jobId: string): string {
  const eid = encodeURIComponent(infId);
  return `/api/inference/${eid}/download?job_id=${encodeURIComponent(jobId)}`;
}

export function fetchInferenceComparison(
  infId: string,
  otherInfId: string,
  jobId: string,
): Promise<ComparisonStats> {
  return apiFetch(
    `/inference/${infId}/comparison/${otherInfId}?job_id=${encodeURIComponent(jobId)}`,
  );
}
