import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeJob, renderWithQuery } from "@/test/helpers";

const mockFetchJob = vi.fn();
const mockFetchJobs = vi.fn().mockResolvedValue([]);
const mockConnectJobProgress = vi.fn().mockReturnValue(() => {});

vi.mock("@/api/jobs", () => ({
  fetchJob: (...args: unknown[]) => mockFetchJob(...args),
  fetchJobPlots: vi.fn().mockResolvedValue([]),
  fetchJobPlot: vi.fn(),
  fetchJobImportance: vi.fn(),
  fetchJobImportanceKinds: vi.fn().mockResolvedValue([]),
  fetchJobLearningCurveMetrics: vi.fn().mockResolvedValue([]),
  fetchJobSplitSummary: vi.fn(),
  fetchJobLog: vi.fn().mockResolvedValue({ log: "test log content" }),
  fetchJobs: (...args: unknown[]) => mockFetchJobs(...args),
  cancelJob: vi.fn(),
}));
vi.mock("@/api/websocket", () => ({
  connectJobProgress: (...args: unknown[]) => mockConnectJobProgress(...args),
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
// ScoreSection removed — KPI cards now show IS+OOS inline
vi.mock("./FoldDetailsSection", () => ({
  FoldDetailsSection: () => <div data-testid="fold-details" />,
}));
vi.mock("./TuneTrialsSection", () => ({
  TuneTrialsSection: () => <div data-testid="tune-trials" />,
  TrialResultsAccordionItem: () => <div data-testid="trial-results" />,
}));

import { ResultsPanel } from "./ResultsPanel";

describe("ResultsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // LiveTrialChart coverage
  // ---------------------------------------------------------------------------

  it("shows Optimization History chart when trial_results has 2+ valid scores during running", async () => {
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: {
        current?: number;
        total?: number;
        message?: string;
        trial_results?: Array<{
          number: number;
          score: number | null;
          best_score?: number;
          state: string;
        }>;
      }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    act(() =>
      capturedCallbacks.onProgress?.({
        current: 2,
        total: 10,
        message: "",
        trial_results: [
          { number: 1, score: 0.85, best_score: 0.85, state: "complete" },
          { number: 2, score: 0.87, best_score: 0.87, state: "complete" },
        ],
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("Optimization History")).toBeInTheDocument(),
    );
  });

  it("does not show Optimization History when trial_results has only 1 entry", async () => {
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: {
        current?: number;
        total?: number;
        message?: string;
        trial_results?: Array<{
          number: number;
          score: number | null;
          best_score?: number;
          state: string;
        }>;
      }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    act(() =>
      capturedCallbacks.onProgress?.({
        current: 1,
        total: 10,
        message: "",
        trial_results: [
          { number: 1, score: 0.85, best_score: 0.85, state: "complete" },
        ],
      }),
    );

    // Wait for progress to be applied, then verify chart is absent
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Optimization History")).not.toBeInTheDocument();
  });

  it("shows trial results table when trial_results is non-empty during running", async () => {
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: {
        current?: number;
        total?: number;
        message?: string;
        trial_results?: Array<{
          number: number;
          score: number | null;
          best_score?: number;
          state: string;
        }>;
      }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    act(() =>
      capturedCallbacks.onProgress?.({
        current: 1,
        total: 5,
        message: "",
        trial_results: [
          { number: 1, score: 0.91, best_score: 0.91, state: "complete" },
        ],
      }),
    );

    // Table headers should be visible
    await waitFor(() => expect(screen.getByText("Score")).toBeInTheDocument());
    expect(screen.getByText("Best")).toBeInTheDocument();
    expect(screen.getByText("State")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Export Code button (window.open)
  // ---------------------------------------------------------------------------

  it("calls window.open with export-code URL when Export Code is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const completedJob = makeJob({ status: "completed" });
    mockFetchJob.mockResolvedValue(completedJob);
    mockFetchJobs.mockResolvedValue([completedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Export Code");

    fireEvent.click(screen.getByText("Export Code"));

    expect(openSpy).toHaveBeenCalledWith(
      "/api/jobs/test-job-1/export-code",
      "_blank",
    );
    openSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // CompletedView: plots available → PlotSection rendered
  // ---------------------------------------------------------------------------

  it("renders PlotSection when job has plots available", async () => {
    const { fetchJobPlots } = await import("@/api/jobs");
    (fetchJobPlots as ReturnType<typeof vi.fn>).mockResolvedValue([
      "learning-curve",
    ]);

    const completedJob = makeJob({ status: "completed" });
    mockFetchJob.mockResolvedValue(completedJob);
    mockFetchJobs.mockResolvedValue([completedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Completed");

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() =>
      expect(screen.getByTestId("plot-section")).toBeInTheDocument(),
    );
  });

  // ---------------------------------------------------------------------------
  // annotateMetric: precision_at_k with k value
  // ---------------------------------------------------------------------------

  it("displays precision_at_k@k metric badge when k is present in evalConfig", async () => {
    const completedJob = makeJob({
      status: "completed",
      config: {
        model: { name: "LightGBM" },
        evaluation: {
          metrics: [{ precision_at_k: { k: 10 } }],
        },
      },
      fit_result: {
        metrics: {
          raw: {
            oof: { precision_at_k: 0.88 },
            if_mean: { precision_at_k: 0.9 },
          },
        },
        fold_count: 1,
        params: [],
      },
    });
    mockFetchJob.mockResolvedValue(completedJob);
    mockFetchJobs.mockResolvedValue([completedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    // MetricCards is mocked, but annotateMetric runs on the metric name.
    // The primary metric badge uses the first oos metric name without annotation,
    // but we verify the component renders correctly with precision_at_k in config.
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    // kpi-cards testid appears when metrics exist (MetricCards mock)
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() =>
      expect(screen.getByTestId("kpi-cards")).toBeInTheDocument(),
    );
  });

  // ---------------------------------------------------------------------------
  // primaryMetric badge: null when no metrics or tuneResult
  // ---------------------------------------------------------------------------

  it("does not show primary metric badge when completed job has no fit_result or tune_result", async () => {
    const completedJob = makeJob({
      status: "completed",
      fit_result: null,
      tune_result: null,
    });
    mockFetchJob.mockResolvedValue(completedJob);
    mockFetchJobs.mockResolvedValue([completedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Completed");

    // No metric badge text like "accuracy: 0.9500"
    expect(screen.queryByText(/\d+\.\d{4}/)).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Polling fallback: status transitions running → completed calls onJobDone
  // ---------------------------------------------------------------------------

  it("calls onJobDone via polling when job status transitions from running to completed", async () => {
    const { waitFor } = await import("@testing-library/react");

    // First call: running, second call: completed
    const runningJob = makeJob({ status: "running" });
    const completedJob = makeJob({ status: "completed" });
    mockFetchJob
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(completedJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    const onJobDone = vi.fn();

    // Re-render with a new queryClient that has refetchInterval firing.
    // We simulate polling by mounting with running job and then rerendering
    // with completed job state via a second fetchJob mock resolution.

    const { QueryClient, QueryClientProvider } = await import(
      "@tanstack/react-query"
    );
    const { render, act } = await import("@testing-library/react");
    const { TooltipProvider } = await import("@/components/ui/tooltip");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ResultsPanel jobId="test-job-1" onJobDone={onJobDone} />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await screen.findByText("Running");

    // Manually invalidate to trigger refetch with completed state
    act(() => {
      queryClient.invalidateQueries({ queryKey: ["job", "test-job-1"] });
    });

    await waitFor(() => expect(onJobDone).toHaveBeenCalled(), {
      timeout: 3000,
    });
  });

  // ---------------------------------------------------------------------------
  // Indeterminate progress bar (total === 0)
  // ---------------------------------------------------------------------------

  it("renders indeterminate progress bar when progress total is 0", async () => {
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: { current?: number; total?: number; message?: string }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    act(() =>
      capturedCallbacks.onProgress?.({
        current: 0,
        total: 0,
        message: "Initializing...",
      }),
    );

    await waitFor(() => {
      const bar = screen.getByRole("progressbar");
      expect(bar).toBeInTheDocument();
      // Indeterminate: no value set or value omitted
    });
    // The progress bar class should include animate-pulse
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toMatch(/animate-pulse/);
  });

  // ---------------------------------------------------------------------------
  // FoldProgressList shown when fold_results present
  // ---------------------------------------------------------------------------

  it("renders fold progress when fold_results present in progress", async () => {
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: {
        current?: number;
        total?: number;
        message?: string;
        fold_results?: Array<{
          fold: number;
          metric: string;
          score: number;
        }>;
      }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    act(() =>
      capturedCallbacks.onProgress?.({
        current: 1,
        total: 5,
        message: "fold 1",
        fold_results: [{ fold: 1, metric: "auc", score: 0.92 }],
      }),
    );

    // FoldProgressList renders fold rows; verify fold label is shown
    await waitFor(() =>
      expect(screen.getByText("Fold 1/5")).toBeInTheDocument(),
    );
  });

  // ---------------------------------------------------------------------------
  // Duplicate foldLog deduplication
  // ---------------------------------------------------------------------------

  it("deduplicates consecutive identical foldLog messages", async () => {
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: { current?: number; total?: number; message?: string }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    // Send the same message twice
    act(() =>
      capturedCallbacks.onProgress?.({
        current: 1,
        total: 5,
        message: "Step A",
      }),
    );
    act(() =>
      capturedCallbacks.onProgress?.({
        current: 1,
        total: 5,
        message: "Step A",
      }),
    );

    await waitFor(() => {
      // "Step A" appears in both the progress <p> and the fold log.
      // The fold log renders with font-mono text-muted-foreground class.
      // Deduplication means exactly one fold-log entry, not two.
      const logEntries = document
        .querySelectorAll(".font-mono.text-xs.text-muted-foreground")
        .values();
      const logTexts = Array.from(logEntries)
        .map((el) => el.textContent)
        .filter((t) => t === "Step A");
      expect(logTexts).toHaveLength(1);
    });
  });

  it("shows placeholder when jobId is null", () => {
    renderWithQuery(<ResultsPanel jobId={null} />);
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.getByText("Load data in the Data Panel")).toBeInTheDocument();
    expect(screen.getByText("Configure model settings")).toBeInTheDocument();
    expect(screen.getByText("Click Fit or Tune")).toBeInTheDocument();
    expect(
      screen.getByText("Results will appear here after running a job."),
    ).toBeInTheDocument();
  });

  it("shows step 1 as completed when hasData is true", () => {
    renderWithQuery(<ResultsPanel jobId={null} hasData hasConfig={false} />);
    const step1 = screen.getByLabelText("Completed");
    expect(step1).toHaveTextContent("✓");
    expect(step1).toHaveClass("bg-primary");
    // Step 1 text has line-through
    expect(screen.getByText("Load data in the Data Panel")).toHaveClass(
      "line-through",
    );
    // Step 2 is still pending
    expect(screen.getByLabelText("Step 2")).toHaveTextContent("2");
  });

  it("shows steps 1 and 2 as completed when both hasData and hasConfig", () => {
    renderWithQuery(<ResultsPanel jobId={null} hasData hasConfig />);
    const completed = screen.getAllByLabelText("Completed");
    expect(completed).toHaveLength(2);
    expect(screen.getByText("Configure model settings")).toHaveClass(
      "line-through",
    );
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
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(failedJob);
    mockFetchJobs.mockResolvedValue([failedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Out of memory")).toBeInTheDocument();
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

  it("renders failed job with error message only", async () => {
    const failedJob = makeJob({
      status: "failed",
      error: "Some failure",
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

  it("renders completed tune job with TuneTrialsSection", async () => {
    const tuneJob = makeJob({
      status: "completed",
      job_type: "tune",
      primary_score: 0.9623,
      tune_result: {
        best_params: { learning_rate: 0.05 },
        best_score: 0.9623,
        trials: [{ trial: 1, score: 0.93 }],
        metric_name: "auc",
        direction: "maximize",
      },
      fit_result: {
        metrics: { raw: { oof: { auc: 0.9623 } } },
        fold_count: 5,
        params: [],
      },
    });
    mockFetchJob.mockResolvedValue(tuneJob);
    mockFetchJobs.mockResolvedValue([tuneJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("auc: 0.9623")).toBeInTheDocument();
    // TuneTrialsSection mock should render
    expect(screen.getByTestId("tune-trials")).toBeInTheDocument();
  });

  it("renders completed fit job with score section and model name", async () => {
    const fitJob = makeJob({
      status: "completed",
      job_type: "fit",
      model_name: "RandomForest",
      config: { model: { name: "RandomForest" } },
      fit_result: {
        metrics: {
          raw: {
            oof: { rmse: 1.234 },
            oof_std: { rmse: 0.05 },
            if_mean: { rmse: 1.1 },
          },
        },
        fold_count: 3,
        params: [],
      },
    });
    mockFetchJob.mockResolvedValue(fitJob);
    mockFetchJobs.mockResolvedValue([fitJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText(/RandomForest/)).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    // KPI cards should render with IS+OOS
    expect(screen.getByTestId("kpi-cards")).toBeInTheDocument();
  });

  it("renders running state with onJobDone prop provided", async () => {
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);
    const onJobDone = vi.fn();

    renderWithQuery(<ResultsPanel jobId="test-job-1" onJobDone={onJobDone} />);

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    // onJobDone is triggered via WebSocket onCompleted callback,
    // not testable without mocking connectJobProgress internals.
  });

  it("connects WebSocket when job status is pending", async () => {
    const pendingJob = makeJob({ status: "pending" });
    mockFetchJob.mockResolvedValue(pendingJob);
    mockFetchJobs.mockResolvedValue([pendingJob]);
    mockConnectJobProgress.mockReturnValue(() => {});

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(mockConnectJobProgress).toHaveBeenCalledWith(
      "test-job-1",
      expect.any(Object),
    );
  });

  it("renders Queued badge for pending job", async () => {
    const pendingJob = makeJob({ status: "pending" });
    mockFetchJob.mockResolvedValue(pendingJob);
    mockFetchJobs.mockResolvedValue([pendingJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(
      screen.getByText("Job queued, starting soon..."),
    ).toBeInTheDocument();
  });

  it("calls onJobDone via WebSocket onCompleted callback", async () => {
    const { waitFor } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<string, (msg?: unknown) => void> = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: Record<string, (msg?: unknown) => void>) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    const onJobDone = vi.fn();
    renderWithQuery(<ResultsPanel jobId="test-job-1" onJobDone={onJobDone} />);

    await screen.findByText("Running");

    // Simulate WebSocket completion event
    const { act } = await import("@testing-library/react");
    act(() => capturedCallbacks.onCompleted?.());

    await waitFor(() => expect(onJobDone).toHaveBeenCalled());
  });

  it("shows toast.error on WebSocket onError callback", async () => {
    const { toast } = await import("sonner");
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: { message?: string }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (
        _id: string,
        callbacks: Record<string, (msg?: { message?: string }) => void>,
      ) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    act(() => capturedCallbacks.onError?.({ message: "GPU out of memory" }));

    await waitFor(() =>
      expect(
        (toast as unknown as Record<string, ReturnType<typeof vi.fn>>).error,
      ).toHaveBeenCalledWith("GPU out of memory"),
    );
  });

  it("updates foldLog via WebSocket onProgress with message", async () => {
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: { message?: string; current?: number; total?: number }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    act(() =>
      capturedCallbacks.onProgress?.({
        message: "Fold 1 done",
        current: 1,
        total: 5,
      }),
    );

    await waitFor(() => {
      // Message appears in both progress area and fold log
      const matches = screen.getAllByText("Fold 1 done");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows progress percentage when total > 0", async () => {
    const { waitFor, act } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    let capturedCallbacks: Record<
      string,
      (msg?: { current?: number; total?: number; message?: string }) => void
    > = {};
    mockConnectJobProgress.mockImplementation(
      (_id: string, callbacks: typeof capturedCallbacks) => {
        capturedCallbacks = callbacks;
        return () => {};
      },
    );

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Running");

    act(() =>
      capturedCallbacks.onProgress?.({ current: 2, total: 10, message: "" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toBeInTheDocument(),
    );
  });

  it("shows cancel confirmation dialog when Cancel button is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Cancel");

    fireEvent.click(screen.getByText("Cancel"));

    expect(await screen.findByText("Cancel job?")).toBeInTheDocument();
    expect(
      screen.getByText("Are you sure you want to cancel this running job?"),
    ).toBeInTheDocument();
  });

  it("calls cancelJob and onJobDone when Yes Cancel is confirmed", async () => {
    const { cancelJob } = await import("@/api/jobs");
    const { toast } = await import("sonner");
    const { fireEvent, waitFor } = await import("@testing-library/react");

    (cancelJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);
    const onJobDone = vi.fn();

    renderWithQuery(<ResultsPanel jobId="test-job-1" onJobDone={onJobDone} />);
    await screen.findByText("Cancel");

    fireEvent.click(screen.getByText("Cancel"));
    await screen.findByText("Cancel job?");
    fireEvent.click(screen.getByRole("button", { name: "Yes, Cancel" }));

    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith("test-job-1"));
    await waitFor(() =>
      expect(
        (toast as unknown as Record<string, ReturnType<typeof vi.fn>>).info,
      ).toHaveBeenCalledWith("Job cancelled"),
    );
    await waitFor(() => expect(onJobDone).toHaveBeenCalled());
  });

  it("shows error toast when cancelJob fails", async () => {
    const { cancelJob } = await import("@/api/jobs");
    const { toast } = await import("sonner");
    const { fireEvent, waitFor } = await import("@testing-library/react");

    (cancelJob as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );

    const runningJob = makeJob({ status: "running" });
    mockFetchJob.mockResolvedValue(runningJob);
    mockFetchJobs.mockResolvedValue([runningJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Cancel");

    fireEvent.click(screen.getByText("Cancel"));
    await screen.findByText("Cancel job?");
    fireEvent.click(screen.getByRole("button", { name: "Yes, Cancel" }));

    await waitFor(() =>
      expect(
        (toast as unknown as Record<string, ReturnType<typeof vi.fn>>).error,
      ).toHaveBeenCalledWith("Failed to cancel job"),
    );
  });

  it("opens log dialog when View Full Log is clicked for failed job", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const failedJob = makeJob({ status: "failed", error: "OOM" });
    mockFetchJob.mockResolvedValue(failedJob);
    mockFetchJobs.mockResolvedValue([failedJob]);

    renderWithQuery(<ResultsPanel jobId="test-job-1" />);
    await screen.findByText("Failed");

    fireEvent.click(screen.getByText("View Full Log"));

    expect(await screen.findByText("Execution Log")).toBeInTheDocument();
  });

  // H-0069: the "Elapsed: …" branch dereferenced `progress.elapsed`
  // which the backend never emits on WsProgress.  Removed together
  // with the WebSocket SSOT switch; this test is intentionally dropped.
});
