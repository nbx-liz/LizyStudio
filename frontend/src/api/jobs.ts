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
  return apiFetch(`/jobs/${jobId}/importance?kind=${kind}`);
}

export function fetchJobImportanceKinds(jobId: string): Promise<string[]> {
  return apiFetch(`/jobs/${jobId}/importance-kinds`);
}

export function fetchJobPlot(
  jobId: string,
  plotType: string,
): Promise<PlotResponse> {
  return apiFetch(`/jobs/${jobId}/plot/${plotType}`);
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

export function deleteJob(jobId: string): Promise<{ status: string }> {
  return apiFetch(`/jobs/${jobId}`, { method: "DELETE" });
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
