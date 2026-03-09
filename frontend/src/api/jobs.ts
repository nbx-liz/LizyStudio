/**
 * Jobs API client.
 */

import { apiFetch } from "./client";

export interface JobSummary {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  backend_name: string;
  job_type: "fit" | "tune";
  created_at: string;
  completed_at: string | null;
  error: string | null;
  model_name?: string;
  primary_score?: number;
}

export interface FitResult {
  metrics: Record<string, unknown>;
  fold_count: number;
  params: Array<Record<string, unknown>>;
}

export interface TuneResult {
  best_params: Record<string, unknown>;
  best_score: number;
  trials: Array<Record<string, unknown>>;
  metric_name: string;
  direction: string;
}

export interface JobDetail extends JobSummary {
  fit_result?: FitResult;
  tune_result?: TuneResult;
}

export function fetchJobs(status?: string): Promise<JobSummary[]> {
  const params = status ? `?status=${status}` : "";
  return apiFetch(`/jobs/${params}`);
}

export function fetchJob(jobId: string): Promise<JobDetail> {
  return apiFetch(`/jobs/${jobId}`);
}

export function fetchJobMetrics(
  jobId: string,
): Promise<Array<Record<string, unknown>>> {
  return apiFetch(`/jobs/${jobId}/metrics`);
}

export function fetchJobImportance(
  jobId: string,
  kind: string = "split",
): Promise<Record<string, number>> {
  return apiFetch(`/jobs/${jobId}/importance?kind=${kind}`);
}

export function fetchJobPlot(
  jobId: string,
  plotType: string,
): Promise<{ plotly_json: string }> {
  return apiFetch(`/jobs/${jobId}/plot/${plotType}`);
}

export function fetchJobPlots(jobId: string): Promise<string[]> {
  return apiFetch(`/jobs/${jobId}/plots`);
}

export function fetchJobSplitSummary(
  jobId: string,
): Promise<Array<Record<string, unknown>>> {
  return apiFetch(`/jobs/${jobId}/split-summary`);
}

export function deleteJob(jobId: string): Promise<{ status: string }> {
  return apiFetch(`/jobs/${jobId}`, { method: "DELETE" });
}

export function fetchJobConfig(
  jobId: string,
): Promise<Record<string, unknown>> {
  return apiFetch(`/jobs/${jobId}/config`);
}

export function fetchJobLog(jobId: string): Promise<{ log: string }> {
  return apiFetch(`/jobs/${jobId}/log`);
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

export function runFit(): Promise<{ job_id: string }> {
  return apiFetch("/workspace/fit", { method: "POST" });
}

export function runTune(): Promise<{ job_id: string }> {
  return apiFetch("/workspace/tune", { method: "POST" });
}
