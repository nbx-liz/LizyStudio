import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferenceRecord } from "@/api/inference";
import type { JobSummary } from "@/api/types";
import { SetupPanel } from "./SetupPanel";

vi.mock("@/api/inference", () => ({
  uploadInferenceData: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/workspace/FileBrowser", () => ({
  FileBrowser: () => <button type="button">Browse</button>,
}));

describe("SetupPanel", () => {
  afterEach(() => {
    cleanup();
  });

  const baseProps = {
    completedJobs: [] as JobSummary[],
    selectedJobId: null,
    onSelectJob: vi.fn(),
    history: [] as InferenceRecord[],
    selectedInfId: null,
    onSelectInf: vi.fn(),
    onRunInference: vi.fn(),
    isRunning: false,
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

  it("shows target detected when selected job has target column", () => {
    const job: JobSummary = {
      job_id: "j1",
      job_type: "fit",
      status: "completed",
      backend_name: "lizyml",
      model_name: "lgbm",
      config: { data: { target: "price" }, model: { name: "lgbm" } },
      data_ref: {
        source_type: "path",
        path: "/data.csv",
        filename: "data.csv",
        fingerprint: "abc",
        shape: [100, 5],
      },
      created_at: "2025-01-01T00:00:00Z",
      completed_at: "2025-01-01T00:01:00Z",
      error: null,
      error_code: null,
      primary_score: 0.95,
    };
    render(
      <SetupPanel {...baseProps} completedJobs={[job]} selectedJobId="j1" />,
    );
    expect(screen.getByText(/Target.*'price'.*detected/)).toBeInTheDocument();
  });

  it("shows score info for selected job with primary_score", () => {
    const job: JobSummary = {
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
      error_code: null,
      primary_score: 0.9512,
    };
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
});
