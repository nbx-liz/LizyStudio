import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JobDetail } from "@/api/types";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockFetchJob = vi.fn();

vi.mock("@/api/jobs", () => ({
  fetchJob: (...args: unknown[]) => mockFetchJob(...args),
  fetchJobLog: vi.fn().mockResolvedValue({ log: "test log" }),
  cancelJob: vi.fn(),
}));
vi.mock("@/api/websocket", () => ({
  connectJobProgress: vi.fn().mockReturnValue(() => {}),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./CompletedContent", () => ({
  CompletedContent: () => <div>CompletedContent</div>,
}));
vi.mock("./DeleteDialog", () => ({
  DeleteDialog: () => null,
}));
vi.mock("./ExportDialog", () => ({
  ExportDialog: () => null,
}));

import { JobDetailPanel } from "./JobDetail";

function makeJob(overrides: Partial<JobDetail>): JobDetail {
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
    error_code: null,
    primary_score: 0.95,
    fit_result: null,
    tune_result: null,
    model_path: null,
    ...overrides,
  };
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("JobDetailPanel", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("shows Loading... when job data is not yet available", () => {
    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders completed job with action buttons", async () => {
    const completedJob = makeJob({ status: "completed" });
    mockFetchJob.mockResolvedValue(completedJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    // Wait for the job to load
    expect((await screen.findAllByText(/Completed/))[0]).toBeInTheDocument();

    // Action buttons for completed jobs
    expect(screen.getByText("Inference")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
    expect(screen.getByText("Re-fit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();

    // CompletedContent mock should be rendered
    expect(screen.getByText("CompletedContent")).toBeInTheDocument();
  });

  it("renders failed job with Error heading and error message", async () => {
    const failedJob = makeJob({
      status: "failed",
      error: "Division by zero in fold 3",
      error_code: "RUNTIME_ERROR",
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(failedJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Failed/)).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Division by zero in fold 3")).toBeInTheDocument();
    expect(screen.getByText("RUNTIME_ERROR")).toBeInTheDocument();
    expect(screen.getByText("View Full Log")).toBeInTheDocument();

    // Failed jobs get Re-fit and Delete buttons
    expect(screen.getByText("Re-fit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();

    // No Inference or Export for failed jobs
    expect(screen.queryByText("Inference")).not.toBeInTheDocument();
    expect(screen.queryByText("Export")).not.toBeInTheDocument();
  });

  it("renders cancelled job with cancellation message", async () => {
    const cancelledJob = makeJob({
      status: "cancelled",
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(cancelledJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(
      screen.getByText("This job was cancelled before completion."),
    ).toBeInTheDocument();

    // Cancelled jobs get Delete but not Inference/Export
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("Inference")).not.toBeInTheDocument();
    expect(screen.queryByText("Export")).not.toBeInTheDocument();
  });

  it("renders running job with Progress heading and Cancel button", async () => {
    const runningJob = makeJob({
      status: "running",
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(runningJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();

    // Running jobs should not show Delete or completed-only actions
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    expect(screen.queryByText("Inference")).not.toBeInTheDocument();
    expect(screen.queryByText("Export")).not.toBeInTheDocument();
  });

  it("renders header with model name and job number", async () => {
    const job = makeJob({
      status: "completed",
      config: { model: { name: "XGBoost" } },
    });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={3}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Fit #3/)).toBeInTheDocument();
    expect(screen.getByText(/XGBoost/)).toBeInTheDocument();
  });

  it("renders tune job type label correctly", async () => {
    const tuneJob = makeJob({
      status: "completed",
      job_type: "tune",
    });
    mockFetchJob.mockResolvedValue(tuneJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={2}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Tune #2/)).toBeInTheDocument();
  });

  it("renders Config accordion for all job states", async () => {
    const job = makeJob({ status: "failed", error: "Some error" });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Config")).toBeInTheDocument();
  });

  it("renders Unknown error when error is null for failed job", async () => {
    const failedJob = makeJob({
      status: "failed",
      error: null,
      error_code: null,
    });
    mockFetchJob.mockResolvedValue(failedJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Unknown error")).toBeInTheDocument();
  });

  it("shows Fitting... as default progress message for running fit job", async () => {
    const runningJob = makeJob({
      status: "running",
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(runningJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("Fitting...")).toBeInTheDocument();
  });

  it("renders primary metric badge for completed fit job", async () => {
    const job = makeJob({
      status: "completed",
      fit_result: {
        metrics: { accuracy: { is: 0.96, oos: 0.95, oos_std: 0.01 } },
        fold_count: 5,
        params: [],
      },
    });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("accuracy: 0.9500")).toBeInTheDocument();
  });

  it("renders primary metric for completed tune job", async () => {
    const job = makeJob({
      status: "completed",
      job_type: "tune",
      tune_result: {
        best_params: { lr: 0.01 },
        best_score: 0.92,
        trials: [],
        metric_name: "f1",
        direction: "maximize",
      },
    });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={2}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("f1: 0.9200")).toBeInTheDocument();
  });

  it("does not show primary metric for non-completed jobs", async () => {
    const job = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.queryByText(/0\.\d{4}/)).not.toBeInTheDocument();
  });

  it("renders Execution Log accordion for completed jobs", async () => {
    const job = makeJob({ status: "completed" });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Execution Log")).toBeInTheDocument();
  });

  it("does not render Execution Log for running jobs", async () => {
    const job = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.queryByText("Execution Log")).not.toBeInTheDocument();
  });

  it("navigates to inference page when Inference button is clicked", async () => {
    const job = makeJob({ status: "completed" });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    const inferenceBtn = await screen.findByText("Inference");
    inferenceBtn.click();

    expect(mockNavigate).toHaveBeenCalledWith("/inference?job_id=test-job-1");
  });

  it("navigates to workspace for re-fit", async () => {
    const job = makeJob({ status: "completed" });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    const refitBtn = await screen.findByText("Re-fit");
    refitBtn.click();

    expect(mockNavigate).toHaveBeenCalledWith("/", {
      state: { refitJobId: "test-job-1" },
    });
  });
});
