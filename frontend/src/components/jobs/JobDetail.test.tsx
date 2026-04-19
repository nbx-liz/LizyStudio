import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeJob, renderWithProviders } from "@/test/helpers";

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
  // H-0067: retune / resume / lineage surface used by the embedded
  // RetuneActionButton / ResumeActionButton / JobLineageTree.
  retuneJob: vi.fn().mockResolvedValue({
    job_id: "child-job",
    parent_job_id: "parent-job",
  }),
  resumeJob: vi.fn().mockResolvedValue({
    job_id: "child-job",
    parent_job_id: "parent-job",
  }),
  fetchJobLineage: vi.fn().mockResolvedValue({
    tree: {
      job_id: "test-job-1",
      status: "completed",
      job_type: "tune",
      children: [],
    },
  }),
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

  it("renders failed job with error text and View Full Log button", async () => {
    const job = makeJob({
      status: "failed",
      error: "OutOfMemoryError: heap exhausted",
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

    expect(
      await screen.findByText("OutOfMemoryError: heap exhausted"),
    ).toBeInTheDocument();
    expect(screen.getByText("View Full Log")).toBeInTheDocument();
  });

  it("renders tune job primary metric from tune_result", async () => {
    const job = makeJob({
      status: "completed",
      job_type: "tune",
      tune_result: {
        best_params: { learning_rate: 0.05 },
        best_score: 0.9678,
        trials: [],
        metric_name: "auc",
        direction: "maximize",
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

    expect(await screen.findByText(/auc: 0\.9678/)).toBeInTheDocument();
  });

  it("renders fit job primary metric from fit_result", async () => {
    const job = makeJob({
      status: "completed",
      job_type: "fit",
      fit_result: {
        metrics: { auc: { oos: 0.8912, mean: 0.89 } },
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

    expect(await screen.findByText(/auc: 0\.8912/)).toBeInTheDocument();
  });

  it("renders Config accordion trigger for completed job with config", async () => {
    const job = makeJob({
      status: "completed",
      config: {
        model: { name: "LightGBM", params: { learning_rate: 0.1 } },
        data: { target: "y" },
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

    // Config accordion trigger should be visible for completed jobs
    expect(await screen.findByText("Config")).toBeInTheDocument();
    // Config tree content is in a collapsed Radix Accordion item;
    // full content rendering is verified via E2E visual tests.
  });

  it("renders pending job without crashing", async () => {
    const pendingJob = makeJob({
      status: "pending",
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(pendingJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    // Pending jobs should render the job header
    expect(await screen.findByText(/Fit #1/)).toBeInTheDocument();
  });

  it("renders cancelled job with Delete button only", async () => {
    const cancelledJob = makeJob({
      status: "cancelled",
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

    expect(await screen.findByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("Inference")).not.toBeInTheDocument();
    expect(screen.queryByText("Export")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });

  it("renders job with no model name gracefully", async () => {
    const job = makeJob({
      status: "completed",
      config: {},
    });
    mockFetchJob.mockResolvedValue(job);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={5}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Fit #5/)).toBeInTheDocument();
  });

  it("renders completed job without fit_result", async () => {
    const job = makeJob({
      status: "completed",
      fit_result: null,
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

    // Should render without crashing; no metric badge
    expect((await screen.findAllByText(/Completed/))[0]).toBeInTheDocument();
  });

  it("renders failed job with Delete and Re-fit buttons", async () => {
    const failedJob = makeJob({
      status: "failed",
      error: "Training error",
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

    expect(await screen.findByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Re-fit")).toBeInTheDocument();
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });
});

describe("JobDetailPanel - Cancel dialog flow", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("opens cancel confirmation dialog when Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const runningJob = makeJob({ status: "running", completed_at: null });
    mockFetchJob.mockResolvedValue(runningJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    const cancelBtn = await screen.findByText("Cancel");
    await user.click(cancelBtn);

    expect(screen.getByText("Cancel job?")).toBeInTheDocument();
    expect(
      screen.getByText("Are you sure you want to cancel this running job?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Yes, Cancel" }),
    ).toBeInTheDocument();
  });

  it("closes cancel dialog when No button is clicked", async () => {
    const user = userEvent.setup();
    const runningJob = makeJob({ status: "running", completed_at: null });
    mockFetchJob.mockResolvedValue(runningJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    const cancelBtn = await screen.findByText("Cancel");
    await user.click(cancelBtn);

    expect(screen.getByText("Cancel job?")).toBeInTheDocument();

    const noBtn = screen.getByRole("button", { name: "No" });
    await user.click(noBtn);

    await waitFor(() => {
      expect(screen.queryByText("Cancel job?")).not.toBeInTheDocument();
    });
  });

  it("calls cancelJob and shows toast when Yes, Cancel is clicked", async () => {
    const { cancelJob } = await import("@/api/jobs");
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    const runningJob = makeJob({ status: "running", completed_at: null });
    mockFetchJob.mockResolvedValue(runningJob);
    vi.mocked(cancelJob).mockResolvedValue({ status: "cancelled" });

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    const cancelBtn = await screen.findByText("Cancel");
    await user.click(cancelBtn);

    const yesCancelBtn = screen.getByRole("button", { name: "Yes, Cancel" });
    await user.click(yesCancelBtn);

    await waitFor(() => {
      expect(cancelJob).toHaveBeenCalledWith("test-job-1");
      expect(toast.info).toHaveBeenCalledWith("Job cancelled");
    });
  });

  it("shows error toast when cancelJob fails", async () => {
    const { cancelJob } = await import("@/api/jobs");
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    const runningJob = makeJob({ status: "running", completed_at: null });
    mockFetchJob.mockResolvedValue(runningJob);
    vi.mocked(cancelJob).mockRejectedValue(new Error("Network error"));

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    const cancelBtn = await screen.findByText("Cancel");
    await user.click(cancelBtn);

    const yesCancelBtn = screen.getByRole("button", { name: "Yes, Cancel" });
    await user.click(yesCancelBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to cancel job");
    });
  });
});

describe("JobDetailPanel - Log dialog flow", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("opens log dialog when View Full Log is clicked on failed job", async () => {
    const user = userEvent.setup();
    const failedJob = makeJob({
      status: "failed",
      error: "Some failure",
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

    const viewLogBtn = await screen.findByText("View Full Log");
    await user.click(viewLogBtn);

    expect(screen.getByText("Execution Log")).toBeInTheDocument();
  });
});

describe("JobDetailPanel - Export button interaction", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("Export button is present and clickable for completed jobs", async () => {
    const user = userEvent.setup();
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

    const exportBtn = await screen.findByText("Export");
    // ExportDialog is mocked to null, but we verify the button exists and is clickable
    await user.click(exportBtn);
    // No error = button clicked successfully; ExportDialog receives open=true
    expect(exportBtn).toBeInTheDocument();
  });
});

describe("JobDetailPanel - Re-fit navigation", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("navigates to workspace with refitJobId for failed job Re-fit", async () => {
    const user = userEvent.setup();
    const failedJob = makeJob({ status: "failed", error: "Error" });
    mockFetchJob.mockResolvedValue(failedJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-2"
        jobNumber={2}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    const refitBtn = await screen.findByText("Re-fit");
    await user.click(refitBtn);

    expect(mockNavigate).toHaveBeenCalledWith("/", {
      state: { refitJobId: "test-job-2" },
    });
  });
});

describe("JobDetailPanel - ConfigTreeView rendering", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("expands Config accordion and shows primitive values", async () => {
    const user = userEvent.setup();
    const job = makeJob({
      status: "failed",
      error: "err",
      config: { learning_rate: 0.01 },
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

    const configTrigger = await screen.findByText("Config");
    await user.click(configTrigger);

    await waitFor(() => {
      expect(screen.getByText("learning_rate:")).toBeInTheDocument();
      expect(screen.getByText("0.01")).toBeInTheDocument();
    });
  });

  it("expands Config accordion with null config values", async () => {
    const user = userEvent.setup();
    const job = makeJob({
      status: "failed",
      error: "err",
      config: { missing_value: null },
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

    const configTrigger = await screen.findByText("Config");
    await user.click(configTrigger);

    await waitFor(() => {
      expect(screen.getByText("missing_value:")).toBeInTheDocument();
      expect(screen.getByText("null")).toBeInTheDocument();
    });
  });

  it("expands Config accordion with array values via nested node", async () => {
    const user = userEvent.setup();
    const job = makeJob({
      status: "failed",
      error: "err",
      config: { tags: ["alpha", "beta"] },
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

    const configTrigger = await screen.findByText("Config");
    await user.click(configTrigger);

    // After expanding Config, the "tags" key should be visible
    await waitFor(() => {
      expect(screen.getByText("tags")).toBeInTheDocument();
    });

    // Click "tags" to expand the array
    const tagsNode = screen.getByText("tags");
    await user.click(tagsNode);

    await waitFor(() => {
      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("beta")).toBeInTheDocument();
    });
  });

  it("expands nested ConfigTreeNode when clicking on expandable key", async () => {
    const user = userEvent.setup();
    const job = makeJob({
      status: "failed",
      error: "err",
      config: { model: { name: "XGB", depth: 6 } },
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

    const configTrigger = await screen.findByText("Config");
    await user.click(configTrigger);

    // "model" is an expandable node - click to expand
    const modelNode = await screen.findByText("model");
    await user.click(modelNode);

    await waitFor(() => {
      expect(screen.getByText("name:")).toBeInTheDocument();
      expect(screen.getByText("XGB")).toBeInTheDocument();
      expect(screen.getByText("depth:")).toBeInTheDocument();
      expect(screen.getByText("6")).toBeInTheDocument();
    });
  });

  it("collapses ConfigTreeNode when clicking expanded key again", async () => {
    const user = userEvent.setup();
    const job = makeJob({
      status: "failed",
      error: "err",
      config: { params: { lr: 0.05 } },
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

    const configTrigger = await screen.findByText("Config");
    await user.click(configTrigger);

    // Expand the nested node
    const paramsNode = await screen.findByText("params");
    await user.click(paramsNode);
    await waitFor(() => {
      expect(screen.getByText("lr:")).toBeInTheDocument();
    });

    // Collapse it again
    await user.click(paramsNode);
    await waitFor(() => {
      expect(screen.queryByText("lr:")).not.toBeInTheDocument();
    });
  });

  it("shows empty object representation in config", async () => {
    const user = userEvent.setup();
    const job = makeJob({
      status: "failed",
      error: "err",
      config: { empty_obj: {} },
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

    const configTrigger = await screen.findByText("Config");
    await user.click(configTrigger);

    await waitFor(() => {
      expect(screen.getByText("{}")).toBeInTheDocument();
    });
  });

  it("shows empty array representation in config", async () => {
    const user = userEvent.setup();
    const job = makeJob({
      status: "failed",
      error: "err",
      config: { empty_list: [] },
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

    const configTrigger = await screen.findByText("Config");
    await user.click(configTrigger);

    await waitFor(() => {
      expect(screen.getByText("[]")).toBeInTheDocument();
    });
  });
});

describe("JobDetailPanel - RunningView tune progress", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("shows tune progress with trial counts when progress has total > 0", async () => {
    const { connectJobProgress } = await import("@/api/websocket");

    vi.mocked(connectJobProgress).mockImplementation((_jobId, handlers) => {
      // Emit a progress message immediately
      handlers.onProgress?.({
        type: "progress",
        current: 3,
        total: 10,
        message: "Running trial 3",
        elapsed: 5.5,
        metrics: { f1: 0.87 },
      });
      return () => {};
    });

    const tuneJob = makeJob({
      status: "running",
      job_type: "tune",
      completed_at: null,
    });
    mockFetchJob.mockResolvedValue(tuneJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("Running")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Trial 3 / 10")).toBeInTheDocument();
      expect(screen.getByText(/Best so far:/)).toBeInTheDocument();
      expect(screen.getByText(/f1 0\.8700/)).toBeInTheDocument();
    });
  });

  it("shows elapsed time when progress includes elapsed", async () => {
    const { connectJobProgress } = await import("@/api/websocket");

    vi.mocked(connectJobProgress).mockImplementation((_jobId, handlers) => {
      handlers.onProgress?.({
        type: "progress",
        current: 1,
        total: 5,
        message: "Step 1",
        elapsed: 12.345,
        metrics: undefined,
      });
      return () => {};
    });

    const runningJob = makeJob({ status: "running", completed_at: null });
    mockFetchJob.mockResolvedValue(runningJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Elapsed:/)).toBeInTheDocument();
    });
  });

  it("shows custom progress message for running fit job when progress arrives", async () => {
    const { connectJobProgress } = await import("@/api/websocket");

    vi.mocked(connectJobProgress).mockImplementation((_jobId, handlers) => {
      handlers.onProgress?.({
        type: "progress",
        current: 0,
        total: 0,
        message: "Preprocessing data...",
        elapsed: undefined,
        metrics: undefined,
      });
      return () => {};
    });

    const runningJob = makeJob({
      status: "running",
      job_type: "fit",
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

    await waitFor(() => {
      expect(screen.getByText("Preprocessing data...")).toBeInTheDocument();
    });
  });
});

describe("JobDetailPanel - Delete button interaction", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("Delete button click does not throw for completed job (DeleteDialog is mocked)", async () => {
    const user = userEvent.setup();
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

    const deleteBtn = await screen.findByText("Delete");
    await user.click(deleteBtn);
    // DeleteDialog is mocked to null; clicking the button should not throw
    expect(deleteBtn).toBeInTheDocument();
  });

  it("Delete button click does not throw for failed job", async () => {
    const user = userEvent.setup();
    const failedJob = makeJob({ status: "failed", error: "Some error" });
    mockFetchJob.mockResolvedValue(failedJob);

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    const deleteBtn = await screen.findByText("Delete");
    await user.click(deleteBtn);
    expect(deleteBtn).toBeInTheDocument();
  });
});

describe("JobDetailPanel - ExecutionLogContent accordion", () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    vi.clearAllMocks();
  });

  it("shows log content when Execution Log accordion is expanded", async () => {
    const user = userEvent.setup();
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

    // Wait for job to load and Execution Log accordion trigger to appear
    const logTrigger = await screen.findByText("Execution Log");
    await user.click(logTrigger);

    // fetchJobLog is mocked to return { log: "test log" }
    await waitFor(() => {
      expect(screen.getByText("test log")).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------------
  // H-0067: Re-tune / Resume / Lineage in the Jobs page.
  // ----------------------------------------------------------------

  it("shows Re-tune button on a completed tune job", async () => {
    mockFetchJob.mockResolvedValue(
      makeJob({ status: "completed", job_type: "tune" }),
    );

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    await screen.findAllByText(/Completed/);
    expect(
      screen.getByRole("button", {
        name: /Re-tune with additional trials/i,
      }),
    ).toBeInTheDocument();
  });

  it("does NOT show Re-tune on a completed fit job", async () => {
    mockFetchJob.mockResolvedValue(
      makeJob({ status: "completed", job_type: "fit" }),
    );

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    await screen.findAllByText(/Completed/);
    expect(
      screen.queryByRole("button", {
        name: /Re-tune with additional trials/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows Resume button on a failed tune job", async () => {
    mockFetchJob.mockResolvedValue(
      makeJob({ status: "failed", job_type: "tune", completed_at: null }),
    );

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    await screen.findByText(/Failed/);
    expect(
      screen.getByRole("button", {
        name: /Resume tuning from checkpoint/i,
      }),
    ).toBeInTheDocument();
  });

  it("does NOT show Resume on a failed fit job", async () => {
    mockFetchJob.mockResolvedValue(
      makeJob({ status: "failed", job_type: "fit", completed_at: null }),
    );

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    await screen.findByText(/Failed/);
    expect(
      screen.queryByRole("button", {
        name: /Resume tuning from checkpoint/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the Lineage accordion when the lineage has children", async () => {
    mockFetchJob.mockResolvedValue(
      makeJob({ status: "completed", job_type: "tune" }),
    );
    const { fetchJobLineage } = await import("@/api/jobs");
    (fetchJobLineage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      tree: {
        job_id: "test-job-1",
        status: "completed",
        job_type: "tune",
        children: [
          {
            job_id: "child-1",
            status: "running",
            job_type: "tune",
            children: [],
          },
        ],
      },
    });

    renderWithProviders(
      <JobDetailPanel
        jobId="test-job-1"
        jobNumber={1}
        onJobDeleted={vi.fn()}
        onJobChanged={vi.fn()}
      />,
    );

    await screen.findAllByText(/Completed/);
    // Lineage trigger appears once fetchJobLineage resolves.
    expect(await screen.findByText("Lineage")).toBeInTheDocument();
  });
});
