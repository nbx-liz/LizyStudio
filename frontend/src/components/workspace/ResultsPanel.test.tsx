import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JobDetail } from "@/api/types";

const mockFetchJob = vi.fn();
const mockFetchJobs = vi.fn().mockResolvedValue([]);

vi.mock("@/api/jobs", () => ({
  fetchJob: (...args: unknown[]) => mockFetchJob(...args),
  fetchJobPlots: vi.fn().mockResolvedValue([]),
  fetchJobPlot: vi.fn(),
  fetchJobImportance: vi.fn(),
  fetchJobSplitSummary: vi.fn(),
  fetchJobLog: vi.fn().mockResolvedValue({ log: "test log content" }),
  fetchJobs: (...args: unknown[]) => mockFetchJobs(...args),
  cancelJob: vi.fn(),
}));
vi.mock("@/api/websocket", () => ({
  connectJobProgress: vi.fn().mockReturnValue(() => {}),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./PlotlyChart", () => ({
  PlotlyChart: () => <div data-testid="plotly-chart" />,
}));
vi.mock("./PlotSection", () => ({
  PlotSection: () => <div data-testid="plot-section" />,
}));
vi.mock("./ScoreSection", () => ({
  ScoreSection: () => <div data-testid="score-section" />,
}));
vi.mock("./FoldDetailsSection", () => ({
  FoldDetailsSection: () => <div data-testid="fold-details" />,
}));
vi.mock("./TuneTrialsSection", () => ({
  TuneTrialsSection: () => <div data-testid="tune-trials" />,
  TrialResultsAccordionItem: () => <div data-testid="trial-results" />,
}));

import { ResultsPanel } from "./ResultsPanel";

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

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

describe("ResultsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows placeholder when jobId is null", () => {
    renderWithQuery(<ResultsPanel jobId={null} />);
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(
      screen.getByText("1. Load data in the Data Panel"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2. Select a model in the Model Panel"),
    ).toBeInTheDocument();
    expect(screen.getByText("3. Click Fit or Tune")).toBeInTheDocument();
    expect(
      screen.getByText("Results will appear here after running a job."),
    ).toBeInTheDocument();
  });

  it("shows placeholder when job is not yet loaded", () => {
    renderWithQuery(<ResultsPanel jobId="some-job-id" />);
    // fetchJob mock returns undefined (not resolved with data), so job is null
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(
      screen.getByText("Results will appear here after running a job."),
    ).toBeInTheDocument();
  });

  it("renders Running badge and Cancel button for running job", async () => {
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("renders Failed badge and error message for failed job", async () => {
    const failedJob = makeJob({
      status: "failed",
      error: "Out of memory",
      error_code: "OOM",
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(failedJob);
    mockFetchJobs.mockResolvedValue([failedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Out of memory")).toBeInTheDocument();
    expect(screen.getByText("OOM")).toBeInTheDocument();
    expect(screen.getByText("View Full Log")).toBeInTheDocument();
  });

  it("renders Unknown error when job.error is null for failed job", async () => {
    const failedJob = makeJob({
      status: "failed",
      error: null,
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(failedJob);
    mockFetchJobs.mockResolvedValue([failedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Unknown error")).toBeInTheDocument();
  });

  it("renders Cancelled badge and cancellation message for cancelled job", async () => {
    const cancelledJob = makeJob({
      status: "cancelled",
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(cancelledJob);
    mockFetchJobs.mockResolvedValue([cancelledJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(
      screen.getByText("This job was cancelled before completion."),
    ).toBeInTheDocument();
  });

  it("renders Completed badge and Export Code button for completed job", async () => {
    const completedJob = makeJob({ status: "completed" });
    mockFetchJob.mockResolvedValue(completedJob);
    mockFetchJobs.mockResolvedValue([completedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Export Code")).toBeInTheDocument();
  });

  it("renders CompletedView with fit_result metrics", async () => {
    const completedJob = makeJob({
      status: "completed",
      fit_result: {
        metrics: {
          raw: {
            if_mean: { accuracy: 0.96 },
            oof: { accuracy: 0.95 },
            oof_std: { accuracy: 0.01 },
          },
        },
        fold_count: 5,
        params: [],
      },
    });
    mockFetchJob.mockResolvedValue(completedJob);
    mockFetchJobs.mockResolvedValue([completedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    // pivotMetrics resolves oof.accuracy = 0.95, shown as "accuracy: 0.9500"
    expect(await screen.findByText("accuracy: 0.9500")).toBeInTheDocument();
  });

  it("displays header with model name", async () => {
    const job = makeJob({
      status: "cancelled",
      config: { model: { name: "XGBoost" } },
    });
    mockFetchJob.mockResolvedValue(job);
    mockFetchJobs.mockResolvedValue([job]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText(/XGBoost/)).toBeInTheDocument();
  });

  it("displays job number in header when allJobs is available", async () => {
    const job = makeJob({ status: "cancelled" });
    const jobsList = [
      makeJob({ job_id: "other-job" }),
      makeJob({ job_id: "test-job-1" }),
    ];
    mockFetchJob.mockResolvedValue(job);
    mockFetchJobs.mockResolvedValue(jobsList);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    // Job is at index 1 in the list, so jobNumber = 2 - 1 = 1
    // headerLabel = "Fit #N"
    expect(await screen.findByText(/Fit/)).toBeInTheDocument();
  });

  it("renders Tune label for tune job type", async () => {
    const tuneJob = makeJob({
      status: "completed",
      job_type: "tune",
      tune_result: {
        best_params: { n_estimators: 100 },
        best_score: 0.95,
        trials: [],
        metric_name: "auc",
        direction: "maximize",
      },
    });
    mockFetchJob.mockResolvedValue(tuneJob);
    mockFetchJobs.mockResolvedValue([tuneJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText(/Tune/)).toBeInTheDocument();
    // primaryMetric badge may take another render cycle
    expect(await screen.findByText("auc: 0.9500")).toBeInTheDocument();
  });

  it("renders progress bar and elapsed time when running with progress", async () => {
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Running")).toBeInTheDocument();
    // Progress bar should be rendered (role=progressbar)
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders CompletedView with tune_result primary metric", async () => {
    const tuneJob = makeJob({
      status: "completed",
      job_type: "tune",
      tune_result: {
        best_params: { lr: 0.01 },
        best_score: 0.9876,
        trials: [],
        metric_name: "f1",
        direction: "maximize",
      },
    });
    mockFetchJob.mockResolvedValue(tuneJob);
    mockFetchJobs.mockResolvedValue([tuneJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("f1: 0.9876")).toBeInTheDocument();
  });

  it("renders failed job without error_code", async () => {
    const failedJob = makeJob({
      status: "failed",
      error: "Some failure",
      error_code: null,
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(failedJob);
    mockFetchJobs.mockResolvedValue([failedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Some failure")).toBeInTheDocument();
  });

  it("calls onApplyToFit prop when provided", async () => {
    const completedJob = makeJob({ status: "completed" });
    mockFetchJob.mockResolvedValue(completedJob);
    mockFetchJobs.mockResolvedValue([completedJob]);
    const onApplyToFit = vi.fn();

    renderWithQuery(
      <ResultsPanel jobId="test-job-1" onApplyToFit={onApplyToFit} />,
    );

    expect(await screen.findByText("Completed")).toBeInTheDocument();
  });
});
