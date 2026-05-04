import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferenceRecord } from "@/api/inference";
import type { JobSummary } from "@/api/types";
import { SetupPanel } from "./SetupPanel";

const { mockUpload, mockToast } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/api/inference", () => ({
  uploadInferenceData: (...args: unknown[]) => mockUpload(...args),
}));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/components/workspace/FileBrowser", () => ({
  FileBrowser: ({ onSelect }: { onSelect: (p: string) => void }) => (
    <button type="button" onClick={() => onSelect("/browse/selected.csv")}>
      Browse
    </button>
  ),
}));

describe("SetupPanel", () => {
  afterEach(() => {
    cleanup();
  });

  const baseProps = {
    completedJobs: [] as JobSummary[],
    allJobs: [] as JobSummary[],
    selectedJobId: null,
    onSelectJob: vi.fn(),
    history: [] as InferenceRecord[],
    selectedInfId: null,
    onSelectInf: vi.fn(),
    onRunInference: vi.fn(),
    isRunning: false,
    targetCol: "",
  };

  it("renders Inference heading", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.getByText("Inference")).toBeInTheDocument();
  });

  it("renders Model label", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("renders Data label", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.getByText("Data")).toBeInTheDocument();
  });

  it("renders Evaluation label", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.getByText("Evaluation")).toBeInTheDocument();
  });

  it("renders Options label", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.getByText("Options")).toBeInTheDocument();
  });

  it("renders SHAP values checkbox label", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.getByText("SHAP values")).toBeInTheDocument();
  });

  it("renders Run Inference button", () => {
    render(<SetupPanel {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /run inference/i }),
    ).toBeInTheDocument();
  });

  it("disables Run Inference button when no job is selected", () => {
    render(<SetupPanel {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /run inference/i }),
    ).toBeDisabled();
  });

  it("shows Running... text when isRunning is true", () => {
    render(<SetupPanel {...baseProps} isRunning={true} />);
    expect(
      screen.getByRole("button", { name: /running/i }),
    ).toBeInTheDocument();
  });

  it("renders Path and Upload source type buttons", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.getByRole("button", { name: "Path" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("shows path input by default", () => {
    render(<SetupPanel {...baseProps} />);
    expect(
      screen.getByPlaceholderText("/path/to/data.csv"),
    ).toBeInTheDocument();
  });

  it("shows target not found message when no job is selected", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.getByText("Target not found in data")).toBeInTheDocument();
    expect(screen.getByText("Prediction only")).toBeInTheDocument();
  });

  it("shows target detected when targetCol is provided", () => {
    render(<SetupPanel {...baseProps} targetCol="price" />);
    expect(screen.getByText(/Target.*'price'.*detected/)).toBeInTheDocument();
  });

  // Issue #359: Inference dropdown ``#N`` must be derived against the
  // full ``allJobs`` list so it matches what JobsPage shows for the
  // same job_id, even when failed/cancelled jobs sit between
  // completed ones.
  it("renders dropdown #N derived from allJobs (not completedJobs)", async () => {
    const user = userEvent.setup();
    const completedTop = {
      job_id: "j-top",
      job_type: "fit",
      status: "completed",
      backend_name: "lizyml",
      model_name: "lgbm",
      created_at: "2025-01-03T00:00:00Z",
      completed_at: "2025-01-03T00:01:00Z",
      error: null,
      primary_score: 0.7,
      parent_job_id: null,
    } as JobSummary;
    const failedMiddle = {
      ...completedTop,
      job_id: "j-mid-failed",
      status: "failed" as const,
      primary_score: null,
    } as JobSummary;
    const completedBottom = {
      ...completedTop,
      job_id: "j-bottom",
      status: "completed" as const,
      primary_score: 0.5,
    } as JobSummary;
    const allJobs = [completedTop, failedMiddle, completedBottom];
    const completedJobs = [completedTop, completedBottom];
    render(
      <SetupPanel
        {...baseProps}
        allJobs={allJobs}
        completedJobs={completedJobs}
      />,
    );
    await user.click(screen.getByLabelText("Select completed job"));
    // top completed job sits at allJobs idx 0 -> #3
    expect(screen.getByText(/#3 fit lgbm/)).toBeInTheDocument();
    // bottom completed job sits at allJobs idx 2 -> #1 (NOT #2 which
    // would be the buggy completedJobs-only derivation)
    expect(screen.getByText(/#1 fit lgbm/)).toBeInTheDocument();
    expect(screen.queryByText(/#2 fit lgbm/)).not.toBeInTheDocument();
  });

  it("shows score info for selected job with primary_score", () => {
    const job = {
      job_id: "j1",
      job_type: "fit",
      status: "completed",
      backend_name: "lizyml",
      model_name: "lgbm",
      config: { model: { name: "lgbm" } },
      data_ref: {
        source_type: "path",
        path: "/d.csv",
        filename: "d.csv",
        fingerprint: "x",
        shape: [10, 2],
      },
      created_at: "2025-01-01T00:00:00Z",
      completed_at: "2025-01-01T00:01:00Z",
      error: null,
      primary_score: 0.9512,
      parent_job_id: null,
    } as JobSummary;
    render(
      <SetupPanel {...baseProps} completedJobs={[job]} selectedJobId="j1" />,
    );
    expect(screen.getByText(/Score 0\.9512/)).toBeInTheDocument();
  });

  it("does not render History section when history is empty", () => {
    render(<SetupPanel {...baseProps} />);
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("renders History section when history is present", () => {
    const record: InferenceRecord = {
      inf_id: "inf1",
      job_id: "j1",
      data_ref: {
        source_type: "path",
        path: "/d.csv",
        filename: "d.csv",
        fingerprint: "x",
        shape: [50, 3],
      },
      has_ground_truth: false,
      created_at: new Date().toISOString(),
      row_count: 50,
      warnings: [],
    };
    render(<SetupPanel {...baseProps} history={[record]} />);
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("switches to Upload mode when Upload button is clicked", async () => {
    const user = userEvent.setup();
    render(<SetupPanel {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.getByText("Drop CSV/Parquet or click")).toBeInTheDocument();
    // Path input should no longer be visible
    expect(
      screen.queryByPlaceholderText("/path/to/data.csv"),
    ).not.toBeInTheDocument();
  });

  it("handles successful file upload with toast", async () => {
    mockUpload.mockResolvedValue({
      upload_path: "/uploads/test.csv",
      filename: "test.csv",
    });

    const user = userEvent.setup();
    render(<SetupPanel {...baseProps} />);

    // Switch to Upload mode
    await user.click(screen.getByRole("button", { name: "Upload" }));

    // Create a fake file and trigger upload
    const file = new File(["a,b\n1,2"], "test.csv", { type: "text/csv" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(file);
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("Uploaded: test.csv");
    });
  });

  it("handles file upload error with toast", async () => {
    mockUpload.mockRejectedValue(new Error("File too large"));

    const user = userEvent.setup();
    render(<SetupPanel {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Upload" }));

    const file = new File(["data"], "big.csv", { type: "text/csv" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "Upload failed: File too large",
      );
    });
  });

  it("sets data path when Browse selects a file", async () => {
    const user = userEvent.setup();
    render(<SetupPanel {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Browse" }));

    // Data path should be displayed
    expect(screen.getByText("/browse/selected.csv")).toBeInTheDocument();
  });

  it("shows data path text when a path is entered", async () => {
    const user = userEvent.setup();
    render(<SetupPanel {...baseProps} />);

    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await user.clear(input);
    await user.type(input, "/my/data.csv");

    expect(screen.getByText("/my/data.csv")).toBeInTheDocument();
  });

  it("enables Run Inference button when job and data path are set", async () => {
    const user = userEvent.setup();
    const job = {
      job_id: "j1",
      job_type: "fit",
      status: "completed",
      backend_name: "lizyml",
      model_name: "lgbm",
      config: { model: { name: "lgbm" } },
      data_ref: {
        source_type: "path",
        path: "/d.csv",
        filename: "d.csv",
        fingerprint: "x",
        shape: [10, 2],
      },
      created_at: "2025-01-01T00:00:00Z",
      completed_at: "2025-01-01T00:01:00Z",
      error: null,
      primary_score: 0.95,
      parent_job_id: null,
    } as JobSummary;

    render(
      <SetupPanel {...baseProps} completedJobs={[job]} selectedJobId="j1" />,
    );

    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await user.type(input, "/data/test.csv");

    expect(
      screen.getByRole("button", { name: /run inference/i }),
    ).toBeEnabled();
  });

  it("calls onRunInference with correct params when Run button is clicked", async () => {
    const user = userEvent.setup();
    const job = {
      job_id: "j1",
      job_type: "fit",
      status: "completed",
      backend_name: "lizyml",
      model_name: "lgbm",
      config: { data: { target: "y" }, model: { name: "lgbm" } },
      data_ref: {
        source_type: "path",
        path: "/d.csv",
        filename: "d.csv",
        fingerprint: "x",
        shape: [10, 2],
      },
      created_at: "2025-01-01T00:00:00Z",
      completed_at: "2025-01-01T00:01:00Z",
      error: null,
      primary_score: 0.95,
      parent_job_id: null,
    } as JobSummary;

    render(
      <SetupPanel {...baseProps} completedJobs={[job]} selectedJobId="j1" />,
    );

    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await user.type(input, "/data/test.csv");

    await user.click(screen.getByRole("button", { name: /run inference/i }));

    expect(baseProps.onRunInference).toHaveBeenCalledWith({
      dataPath: "/data/test.csv",
      sourceType: "path",
      evaluate: true,
      returnShap: false,
    });
  });

  // Issue #374: Upload mode previously dropped the ``sourceType``
  // between SetupPanel and the API call, so the run request always
  // carried ``source_type: "path"``. The backend then validated the
  // upload tempfile against ALLOWED_FILES_ROOT and rejected it.
  it("forwards sourceType='upload' to onRunInference after upload (Issue #374)", async () => {
    mockUpload.mockResolvedValue({
      upload_path: "/tmp/lizystudio_test.csv",
      filename: "uploaded.csv",
    });
    const job = {
      job_id: "j1",
      job_type: "fit",
      status: "completed",
      backend_name: "lizyml",
      model_name: "lgbm",
      created_at: "2025-01-01T00:00:00Z",
      completed_at: "2025-01-01T00:01:00Z",
      error: null,
      primary_score: 0.9,
      parent_job_id: null,
    } as JobSummary;
    const onRunInference = vi.fn();

    const user = userEvent.setup();
    render(
      <SetupPanel
        {...baseProps}
        onRunInference={onRunInference}
        completedJobs={[job]}
        selectedJobId="j1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Upload" }));
    const file = new File(["a,b\n1,2"], "uploaded.csv", { type: "text/csv" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /run inference/i }));

    expect(onRunInference).toHaveBeenCalledWith({
      dataPath: "/tmp/lizystudio_test.csv",
      sourceType: "upload",
      evaluate: true,
      returnShap: false,
    });
  });
});
