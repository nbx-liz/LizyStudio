/**
 * Shared test rendering helpers.
 *
 * Usage:
 *   import { renderWithQuery, renderWithProviders, makeJob } from "@/test/helpers";
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { JobDetail, JobSummary } from "@/api/types";

/** Wrap component with QueryClientProvider (no routing). */
export function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** Wrap component with QueryClientProvider + MemoryRouter. */
export function renderWithProviders(
  ui: React.ReactElement,
  { initialEntries = ["/"] }: { initialEntries?: string[] } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Factory for JobSummary test data (list endpoint shape). */
export function makeJobSummary(
  overrides: Partial<JobSummary> = {},
): JobSummary {
  return {
    job_id: "test-job-1",
    job_type: "fit",
    status: "completed",
    backend_name: "lizyml",
    model_name: "LightGBM",
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
    error: null,
    primary_score: 0.95,
    ...overrides,
  };
}

/** Factory for JobDetail test data (detail endpoint shape). */
export function makeJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    job_id: "test-job-1",
    job_type: "fit",
    status: "completed",
    backend_name: "lizyml",
    model_name: "LightGBM",
    config: { model: { name: "LightGBM" } },
    data_ref: {
      source_type: "path",
      path: "/data.csv",
      filename: "data.csv",
      fingerprint: "abc123",
      shape: [100, 5],
    },
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
    error: null,
    primary_score: 0.95,
    fit_result: null,
    tune_result: null,
    model_path: null,
    ...overrides,
  };
}
