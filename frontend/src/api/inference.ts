import { apiClient } from "./client";
import type { components } from "./generated/schema";

// --- Types ---
// SSOT: generated schema is the source of truth for these two.
// ``ComparisonStats`` stays hand-written because the backend schema uses a
// structured ``ComparisonGroupStats`` ({mean, std, min, max, count}) while
// consumers currently iterate ``Object.keys(current)`` expecting a
// ``Record<string, number>``. Bridging that is a separate refactor outside
// C-6 Phase 2 scope.

export type InferenceRecord = components["schemas"]["InferenceRecordResponse"];
export type PredictionsResponse = components["schemas"]["PredictionsResponse"];

export interface ComparisonStats {
  current: Record<string, number>;
  other: Record<string, number>;
  current_proba?: Record<string, number>;
  other_proba?: Record<string, number>;
}

// --- Run ---

export async function runInference(params: {
  job_id: string;
  data: { source_type: string; path: string };
  return_shap: boolean;
  evaluate: boolean;
}): Promise<{ inf_id: string; job_id: string }> {
  const { data } = await apiClient.POST("/api/inference/run", {
    body: params as components["schemas"]["RunRequest"],
  });
  if (!data) {
    throw new Error("apiClient returned no data for /api/inference/run");
  }
  return data;
}

export async function uploadInferenceData(
  file: File,
): Promise<{ upload_path: string; filename: string }> {
  const formData = new FormData();
  formData.append("file", file);
  // openapi-fetch would JSON.stringify the body by default; override to
  // pass FormData through unchanged so the browser sets the correct
  // multipart/form-data boundary on the Content-Type header. The
  // generated body type uses ``file: string`` (multipart schemas serialise
  // to string in OpenAPI), so we double-cast via ``unknown`` to satisfy
  // both openapi-fetch's input type and the BodyInit return contract.
  const { data } = await apiClient.POST("/api/inference/upload", {
    body: formData as unknown as components["schemas"]["Body_inference_upload_api_inference_upload_post"],
    bodySerializer: (body) => body as unknown as BodyInit,
  });
  if (!data) {
    throw new Error("apiClient returned no data for /api/inference/upload");
  }
  return data;
}

// --- Query ---

export async function fetchInferenceHistory(
  jobId?: string,
): Promise<InferenceRecord[]> {
  const { data } = await apiClient.GET("/api/inference/history", {
    params: { query: jobId ? { job_id: jobId } : {} },
  });
  if (!data) {
    throw new Error("apiClient returned no data for /api/inference/history");
  }
  return data;
}

export async function fetchInferenceRecord(
  infId: string,
  jobId: string,
): Promise<InferenceRecord> {
  const { data } = await apiClient.GET("/api/inference/{inf_id}", {
    params: { path: { inf_id: infId }, query: { job_id: jobId } },
  });
  if (!data) {
    throw new Error("apiClient returned no data for /api/inference/{inf_id}");
  }
  return data;
}

export async function fetchInferencePredictions(
  infId: string,
  jobId: string,
  rows = 50,
  offset = 0,
): Promise<PredictionsResponse> {
  const { data } = await apiClient.GET("/api/inference/{inf_id}/predictions", {
    params: {
      path: { inf_id: infId },
      query: { job_id: jobId, rows, offset },
    },
  });
  if (!data) {
    throw new Error(
      "apiClient returned no data for /api/inference/{inf_id}/predictions",
    );
  }
  return data;
}

export async function fetchInferenceMetrics(
  infId: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  const { data } = await apiClient.GET("/api/inference/{inf_id}/metrics", {
    params: { path: { inf_id: infId }, query: { job_id: jobId } },
  });
  if (!data) {
    throw new Error(
      "apiClient returned no data for /api/inference/{inf_id}/metrics",
    );
  }
  return data;
}

export async function fetchInferencePlot(
  infId: string,
  jobId: string,
  plotType: string,
): Promise<{ plotly_json: string }> {
  const { data } = await apiClient.GET(
    "/api/inference/{inf_id}/plot/{plot_type}",
    {
      params: {
        path: { inf_id: infId, plot_type: plotType },
        query: { job_id: jobId },
      },
    },
  );
  if (!data) {
    throw new Error(
      "apiClient returned no data for /api/inference/{inf_id}/plot/{plot_type}",
    );
  }
  return data as { plotly_json: string };
}

// Pure URL builder, not routed through apiClient. The anchor ``href`` is
// what the UI actually consumes — there is no response body to type.
export function getInferenceDownloadUrl(infId: string, jobId: string): string {
  const eid = encodeURIComponent(infId);
  return `/api/inference/${eid}/download?job_id=${encodeURIComponent(jobId)}`;
}

export function fetchInferenceShapPlot(
  infId: string,
  jobId: string,
): Promise<{ plotly_json: string }> {
  return fetchInferencePlot(infId, jobId, "shap-summary");
}

export async function fetchInferenceComparison(
  infId: string,
  otherInfId: string,
  jobId: string,
): Promise<ComparisonStats> {
  const { data } = await apiClient.GET(
    "/api/inference/{inf_id}/comparison/{other_inf_id}",
    {
      params: {
        path: { inf_id: infId, other_inf_id: otherInfId },
        query: { job_id: jobId },
      },
    },
  );
  if (!data) {
    throw new Error(
      "apiClient returned no data for /api/inference/{inf_id}/comparison/{other_inf_id}",
    );
  }
  return data as unknown as ComparisonStats;
}
