import { apiClient } from "./client";
import type {
  ImportanceResponse,
  JobDetail,
  JobSummary,
  PlotResponse,
  SplitSummaryRow,
} from "./types";

function unwrap<T>(data: T | undefined, endpoint: string): T {
  if (!data) {
    throw new Error(`apiClient returned no data for ${endpoint}`);
  }
  return data;
}

export async function fetchJobs(status?: string): Promise<JobSummary[]> {
  const { data } = await apiClient.GET("/api/jobs/", {
    params: { query: status ? { status } : {} },
  });
  // H-0085 (Issue #236): generated type is ``JobSummaryResponse[]`` which is
  // structurally assignable to the hand-written ``JobSummary``. Cast once via
  // ``unknown`` — the shape equivalence is verified in api-types-drift CI.
  // SSOT-EXEMPT: JobSummary is re-exported locally for consumer ergonomics;
  // the underlying schema is the backend-owned JobSummaryResponse.
  return unwrap(data, "/api/jobs/") as unknown as JobSummary[];
}

export async function fetchJob(jobId: string): Promise<JobDetail> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}", {
    params: { path: { job_id: jobId } },
  });
  // SSOT-EXEMPT: same as fetchJobs — JobDetail wraps JobDetailResponse.
  return unwrap(data, "/api/jobs/{job_id}") as unknown as JobDetail;
}

export async function fetchJobImportance(
  jobId: string,
  kind = "default",
  options?: { topN?: number },
): Promise<ImportanceResponse> {
  const query: { kind: string; top_n?: number } = { kind };
  if (typeof options?.topN === "number") {
    query.top_n = options.topN;
  }
  const { data } = await apiClient.GET("/api/jobs/{job_id}/importance", {
    params: { path: { job_id: jobId }, query },
  });
  // Backend returns ``dict[str, float]`` (no response_model — flat mapping).
  // SSOT-EXEMPT: #236 — adding a wrapping model would change the wire shape.
  return unwrap(
    data,
    "/api/jobs/{job_id}/importance",
  ) as unknown as ImportanceResponse;
}

export async function fetchJobImportanceKinds(
  jobId: string,
): Promise<string[]> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/importance-kinds", {
    params: { path: { job_id: jobId } },
  });
  // Backend returns ``list[str]`` (no response_model — primitive list).
  // SSOT-EXEMPT: #236 — tracked as a follow-up, wrapping in a model flips wire shape.
  return unwrap(
    data,
    "/api/jobs/{job_id}/importance-kinds",
  ) as unknown as string[];
}

export async function fetchJobLearningCurveMetrics(
  jobId: string,
): Promise<string[]> {
  const { data } = await apiClient.GET(
    "/api/jobs/{job_id}/learning-curve/metrics",
    {
      params: { path: { job_id: jobId } },
    },
  );
  // SSOT-EXEMPT: #236 — same primitive-list reason as fetchJobImportanceKinds.
  return unwrap(
    data,
    "/api/jobs/{job_id}/learning-curve/metrics",
  ) as unknown as string[];
}

export async function fetchJobPlot(
  jobId: string,
  plotType: string,
  options?: { metrics?: string | string[]; kind?: string },
): Promise<PlotResponse> {
  // Backend accepts a single ``metrics`` string (comma-separated for
  // multi-select), so normalise the array form into that shape before
  // handing off to openapi-fetch's query serialiser.
  const metricsStr = Array.isArray(options?.metrics)
    ? options.metrics.join(",")
    : options?.metrics;
  const query: { metrics?: string; kind?: string } = {};
  if (metricsStr) {
    query.metrics = metricsStr;
  }
  if (options?.kind) {
    query.kind = options.kind;
  }
  const { data } = await apiClient.GET("/api/jobs/{job_id}/plot/{plot_type}", {
    params: { path: { job_id: jobId, plot_type: plotType }, query },
  });
  // SSOT-EXEMPT: PlotResponse re-exports the backend PlotResponseModel.
  return unwrap(
    data,
    "/api/jobs/{job_id}/plot/{plot_type}",
  ) as unknown as PlotResponse;
}

export async function fetchJobPlots(jobId: string): Promise<string[]> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/plots", {
    params: { path: { job_id: jobId } },
  });
  // SSOT-EXEMPT: #236 — primitive list, see fetchJobImportanceKinds.
  return unwrap(data, "/api/jobs/{job_id}/plots") as unknown as string[];
}

export async function fetchJobSplitSummary(
  jobId: string,
): Promise<SplitSummaryRow[]> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/split-summary", {
    params: { path: { job_id: jobId } },
  });
  // SSOT-EXEMPT: SplitSummaryRow wraps ``list[dict[str, Any]]`` — backend has
  // no concrete row schema, the shape depends on the CV strategy.
  return unwrap(
    data,
    "/api/jobs/{job_id}/split-summary",
  ) as unknown as SplitSummaryRow[];
}

export async function fetchJobLog(jobId: string): Promise<{ log: string }> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/log", {
    params: { path: { job_id: jobId } },
  });
  // H-0085: backend now returns JobLogResponse; generated type matches the
  // inline return type exactly so no cast is needed.
  return unwrap(data, "/api/jobs/{job_id}/log");
}

export async function cancelJob(jobId: string): Promise<{ status: string }> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/cancel", {
    params: { path: { job_id: jobId } },
  });
  // H-0085: backend now returns CancelJobResponse — direct return.
  return unwrap(data, "/api/jobs/{job_id}/cancel");
}

/**
 * P-0099 v3-20d: request a tune job to pause at the next cooperative
 * callback boundary. Tune-only — fit jobs reject with
 * ``JOB_NOT_PAUSEABLE``.
 */
export async function pauseJob(jobId: string): Promise<{ status: string }> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/pause", {
    params: { path: { job_id: jobId } },
  });
  return unwrap(data, "/api/jobs/{job_id}/pause");
}

/**
 * P-0099 v3-20d: re-launch a paused tune in place (same job_id). The
 * Optuna study re-attaches via ``load_if_exists=True`` and continues
 * from the next trial.
 */
export async function unpauseJob(
  jobId: string,
): Promise<{ status: string; job_id: string }> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/unpause", {
    params: { path: { job_id: jobId } },
  });
  return unwrap(data, "/api/jobs/{job_id}/unpause");
}

export async function deleteJob(
  jobId: string,
  options: { cascade?: boolean } = {},
): Promise<{ status: string; removed_job_ids?: string[] | null }> {
  const query: { cascade?: boolean } = {};
  if (options.cascade) {
    query.cascade = true;
  }
  const { data } = await apiClient.DELETE("/api/jobs/{job_id}", {
    params: { path: { job_id: jobId }, query },
  });
  // H-0085: backend now returns DeleteJobResponse.
  return unwrap(data, "/api/jobs/{job_id} (DELETE)");
}

// --- H-0062: Re-tune / Resume / Lineage ---
//
// H-0085 (Issue #236): backend now exposes RetuneJobResponse / LineageResponse
// as the ``response_model`` so the generated schema contains concrete types.
// The hand-written interfaces below stay for consumer ergonomics (named
// fields, JSDoc) but share shape with the generated models.

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
  /**
   * H-0062: when true, this node hit the lineage depth guard (20) and
   * has additional descendants on the server that are not included in
   * the tree. The UI should surface this so the user knows the view is
   * incomplete.
   */
  truncated?: boolean | null;
}

export async function retuneJob(
  jobId: string,
  body: RetuneRequestBody,
): Promise<RetuneResponse> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/retune", {
    params: { path: { job_id: jobId } },
    body,
  });
  // H-0085: RetuneJobResponse generated type = RetuneResponse shape.
  return unwrap(data, "/api/jobs/{job_id}/retune");
}

export async function resumeJob(
  jobId: string,
  body: ResumeRequestBody = {},
): Promise<RetuneResponse> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/resume", {
    params: { path: { job_id: jobId } },
    body,
  });
  // H-0085.
  return unwrap(data, "/api/jobs/{job_id}/resume");
}

export async function fetchJobLineage(
  jobId: string,
): Promise<{ tree: LineageNode }> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/lineage", {
    params: { path: { job_id: jobId } },
  });
  // H-0085: LineageResponse → { tree: LineageNodeResponse }. Shape matches.
  // SSOT-EXEMPT: openapi-typescript emits the nested Pydantic forward-ref
  // as a structurally-compatible but distinct TS type — cast is still needed
  // to line the two recursive definitions up.
  return unwrap(data, "/api/jobs/{job_id}/lineage") as unknown as {
    tree: LineageNode;
  };
}

export async function exportJob(
  jobId: string,
  exportType: "model" | "report",
  outputPath: string,
): Promise<{ exported_path: string; export_type: string }> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/export", {
    params: { path: { job_id: jobId } },
    body: { export_type: exportType, output_path: outputPath },
  });
  // H-0085: backend now returns ExportJobResponse.
  return unwrap(data, "/api/jobs/{job_id}/export");
}
