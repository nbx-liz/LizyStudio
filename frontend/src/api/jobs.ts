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
  return unwrap(data, "/api/jobs/") as unknown as JobSummary[];
}

export async function fetchJob(jobId: string): Promise<JobDetail> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}", {
    params: { path: { job_id: jobId } },
  });
  return unwrap(data, "/api/jobs/{job_id}") as unknown as JobDetail;
}

export async function fetchJobImportance(
  jobId: string,
  kind = "default",
): Promise<ImportanceResponse> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/importance", {
    params: { path: { job_id: jobId }, query: { kind } },
  });
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
  return unwrap(
    data,
    "/api/jobs/{job_id}/plot/{plot_type}",
  ) as unknown as PlotResponse;
}

export async function fetchJobPlots(jobId: string): Promise<string[]> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/plots", {
    params: { path: { job_id: jobId } },
  });
  return unwrap(data, "/api/jobs/{job_id}/plots") as unknown as string[];
}

export async function fetchJobSplitSummary(
  jobId: string,
): Promise<SplitSummaryRow[]> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/split-summary", {
    params: { path: { job_id: jobId } },
  });
  return unwrap(
    data,
    "/api/jobs/{job_id}/split-summary",
  ) as unknown as SplitSummaryRow[];
}

export async function fetchJobLog(jobId: string): Promise<{ log: string }> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/log", {
    params: { path: { job_id: jobId } },
  });
  return unwrap(data, "/api/jobs/{job_id}/log") as unknown as {
    log: string;
  };
}

export async function cancelJob(jobId: string): Promise<{ status: string }> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/cancel", {
    params: { path: { job_id: jobId } },
  });
  return unwrap(data, "/api/jobs/{job_id}/cancel") as unknown as {
    status: string;
  };
}

export async function deleteJob(
  jobId: string,
  options: { cascade?: boolean } = {},
): Promise<{ status: string; removed_job_ids?: string[] }> {
  const query: { cascade?: boolean } = {};
  if (options.cascade) {
    query.cascade = true;
  }
  const { data } = await apiClient.DELETE("/api/jobs/{job_id}", {
    params: { path: { job_id: jobId }, query },
  });
  return unwrap(data, "/api/jobs/{job_id} (DELETE)") as unknown as {
    status: string;
    removed_job_ids?: string[];
  };
}

// --- H-0062: Re-tune / Resume / Lineage ---
//
// Backend for these endpoints returns ``{[key: string]: string}`` /
// ``{[key: string]: unknown}`` (no explicit response_model). We keep the
// hand-written response interfaces so consumers get named fields;
// revisit once backend adopts Pydantic response models (out of scope
// for C-6).

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
  truncated?: boolean;
}

export async function retuneJob(
  jobId: string,
  body: RetuneRequestBody,
): Promise<RetuneResponse> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/retune", {
    params: { path: { job_id: jobId } },
    body,
  });
  return unwrap(data, "/api/jobs/{job_id}/retune") as unknown as RetuneResponse;
}

export async function resumeJob(
  jobId: string,
  body: ResumeRequestBody = {},
): Promise<RetuneResponse> {
  const { data } = await apiClient.POST("/api/jobs/{job_id}/resume", {
    params: { path: { job_id: jobId } },
    body,
  });
  return unwrap(data, "/api/jobs/{job_id}/resume") as unknown as RetuneResponse;
}

export async function fetchJobLineage(
  jobId: string,
): Promise<{ tree: LineageNode }> {
  const { data } = await apiClient.GET("/api/jobs/{job_id}/lineage", {
    params: { path: { job_id: jobId } },
  });
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
  return unwrap(data, "/api/jobs/{job_id}/export") as unknown as {
    exported_path: string;
    export_type: string;
  };
}
