import { apiFetch } from "./client";
import type {
  ImportanceResponse,
  JobDetail,
  JobSummary,
  PlotResponse,
  SplitSummaryRow,
} from "./types";

export function fetchJobs(status?: string): Promise<JobSummary[]> {
  const params = status ? `?status=${status}` : "";
  return apiFetch(`/jobs${params}`);
}

export function fetchJob(jobId: string): Promise<JobDetail> {
  return apiFetch(`/jobs/${jobId}`);
}

export function fetchJobImportance(
  jobId: string,
  kind = "default",
): Promise<ImportanceResponse> {
  return apiFetch(
    `/jobs/${encodeURIComponent(jobId)}/importance?kind=${encodeURIComponent(kind)}`,
  );
}

export function fetchJobImportanceKinds(jobId: string): Promise<string[]> {
  return apiFetch(`/jobs/${jobId}/importance-kinds`);
}

export function fetchJobLearningCurveMetrics(jobId: string): Promise<string[]> {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}/learning-curve/metrics`);
}

export function fetchJobPlot(
  jobId: string,
  plotType: string,
  options?: { metrics?: string | string[]; kind?: string },
): Promise<PlotResponse> {
  const params = new URLSearchParams();
  if (options?.metrics) {
    const m = Array.isArray(options.metrics)
      ? options.metrics.join(",")
      : options.metrics;
    if (m) params.set("metrics", m);
  }
  if (options?.kind) {
    params.set("kind", options.kind);
  }
  const qs = params.toString();
  const url = `/jobs/${encodeURIComponent(jobId)}/plot/${encodeURIComponent(plotType)}${qs ? `?${qs}` : ""}`;
  return apiFetch(url);
}

export function fetchJobPlots(jobId: string): Promise<string[]> {
  return apiFetch(`/jobs/${jobId}/plots`);
}

export function fetchJobSplitSummary(
  jobId: string,
): Promise<SplitSummaryRow[]> {
  return apiFetch(`/jobs/${jobId}/split-summary`);
}

export function fetchJobLog(jobId: string): Promise<{ log: string }> {
  return apiFetch(`/jobs/${jobId}/log`);
}

export function cancelJob(jobId: string): Promise<{ status: string }> {
  return apiFetch(`/jobs/${jobId}/cancel`, { method: "POST" });
}

export function deleteJob(
  jobId: string,
  options: { cascade?: boolean } = {},
): Promise<{ status: string; removed_job_ids?: string[] }> {
  const qs = options.cascade ? "?cascade=true" : "";
  return apiFetch(`/jobs/${jobId}${qs}`, { method: "DELETE" });
}

// --- H-0062: Re-tune / Resume / Lineage ---

export interface RetuneRequestBody {
  n_trials: number;
  expand_boundary?: boolean;
  boundary_threshold?: number;
}

export interface ResumeRequestBody {
  n_trials?: number;
}

export interface RetuneResponse {
  job_id: string;
  parent_job_id: string;
}

export interface LineageNode {
  job_id: string;
  status: string;
  job_type: string;
  children: LineageNode[];
}

export function retuneJob(
  jobId: string,
  body: RetuneRequestBody,
): Promise<RetuneResponse> {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}/retune`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resumeJob(
  jobId: string,
  body: ResumeRequestBody = {},
): Promise<RetuneResponse> {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}/resume`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchJobLineage(jobId: string): Promise<{ tree: LineageNode }> {
  return apiFetch(`/jobs/${encodeURIComponent(jobId)}/lineage`);
}

export function exportJob(
  jobId: string,
  exportType: "model" | "report",
  outputPath: string,
): Promise<{ exported_path: string; export_type: string }> {
  return apiFetch(`/jobs/${jobId}/export`, {
    method: "POST",
    body: JSON.stringify({ export_type: exportType, output_path: outputPath }),
  });
}
