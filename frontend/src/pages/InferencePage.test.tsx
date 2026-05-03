import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeJob, renderWithProviders } from "@/test/helpers";
import { InferencePage } from "./InferencePage";

// --- API mocks ---

const {
  mockFetchJobs,
  mockFetchInferenceHistory,
  mockFetchInferenceRecord,
  mockRunInference,
  mockToast,
} = vi.hoisted(() => ({
  mockFetchJobs: vi.fn().mockResolvedValue([]),
  mockFetchInferenceHistory: vi.fn().mockResolvedValue([]),
  mockFetchInferenceRecord: vi.fn().mockResolvedValue(null),
  mockRunInference: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/api/inference", () => ({
  fetchInferenceHistory: (...args: unknown[]) =>
    mockFetchInferenceHistory(...args),
  fetchInferenceRecord: (...args: unknown[]) =>
    mockFetchInferenceRecord(...args),
  runInference: (...args: unknown[]) => mockRunInference(...args),
  uploadInferenceData: vi.fn(),
  fetchInferencePredictions: vi.fn(),
  fetchInferenceMetrics: vi.fn(),
  fetchInferencePlot: vi.fn(),
  getInferenceDownloadUrl: vi.fn().mockReturnValue(""),
  fetchInferenceShapPlot: vi.fn(),
  fetchInferenceComparison: vi.fn(),
}));

vi.mock("@/api/jobs", () => ({
  fetchJobs: (...args: unknown[]) => mockFetchJobs(...args),
  fetchJob: vi.fn(),
  cancelJob: vi.fn(),
  deleteJob: vi.fn(),
  exportJob: vi.fn(),
  fetchJobLog: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

// --- Child component mocks that capture props ---

let capturedSetupProps: Record<string, unknown> = {};

vi.mock("@/components/inference/SetupPanel", () => ({
  SetupPanel: (props: Record<string, unknown>) => {
    capturedSetupProps = props;
    return <div data-testid="setup-panel">SetupPanel</div>;
  },
}));
vi.mock("@/components/inference/ResultsWithGT", () => ({
  ResultsWithGT: () => <div data-testid="results-with-gt">ResultsWithGT</div>,
}));
vi.mock("@/components/inference/ResultsPredOnly", () => ({
  ResultsPredOnly: () => (
    <div data-testid="results-pred-only">ResultsPredOnly</div>
  ),
}));

function makeInfRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    inf_id: "inf-1",
    job_id: "job-1",
    data_ref: {
      source_type: "path",
      path: "/data/test.csv",
      filename: "test.csv",
      fingerprint: "abc123",
      shape: [100, 5],
    },
    has_ground_truth: false,
    created_at: "2026-01-01T01:00:00Z",
    row_count: 100,
    warnings: [],
    ...overrides,
  };
}

// --- Tests ---

describe("InferencePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSetupProps = {};

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the page with setup panel and placeholder text", () => {
    renderWithProviders(<InferencePage />);
    expect(screen.getByTestId("setup-panel")).toBeInTheDocument();
    expect(
      screen.getByText("Select a model to get started"),
    ).toBeInTheDocument();
  });

  it("renders the two-panel layout structure", () => {
    renderWithProviders(<InferencePage />);
    expect(screen.getByTestId("setup-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("results-with-gt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("results-pred-only")).not.toBeInTheDocument();
  });

  it("passes completed jobs to SetupPanel", async () => {
    const completedJob = makeJob({ job_id: "job-1", status: "completed" });
    const runningJob = makeJob({ job_id: "job-2", status: "running" });
    mockFetchJobs.mockResolvedValue([completedJob, runningJob]);

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });
    const jobs = capturedSetupProps.completedJobs as Array<
      Record<string, unknown>
    >;
    expect(jobs[0].job_id).toBe("job-1");
  });

  it("shows placeholder when job selected but no inference record", async () => {
    const job = makeJob({ job_id: "job-1" });
    mockFetchJobs.mockResolvedValue([job]);

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });

    // Simulate job selection via the captured callback
    const onSelectJob = capturedSetupProps.onSelectJob as (id: string) => void;
    act(() => onSelectJob("job-1"));

    expect(
      screen.getByText("Run inference or select from history"),
    ).toBeInTheDocument();
  });

  it("renders ResultsPredOnly when inference record has no ground truth", async () => {
    const job = makeJob({ job_id: "job-1" });
    const record = makeInfRecord({
      inf_id: "inf-1",
      has_ground_truth: false,
    });
    mockFetchJobs.mockResolvedValue([job]);
    mockFetchInferenceHistory.mockResolvedValue([record]);
    mockFetchInferenceRecord.mockResolvedValue(record);

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });

    // Select job → triggers history fetch → auto-selects latest inference
    const onSelectJob = capturedSetupProps.onSelectJob as (id: string) => void;
    act(() => onSelectJob("job-1"));

    await waitFor(() => {
      expect(screen.getByTestId("results-pred-only")).toBeInTheDocument();
    });
  });

  it("renders ResultsWithGT when inference record has ground truth", async () => {
    const job = makeJob({ job_id: "job-1" });
    const record = makeInfRecord({
      inf_id: "inf-1",
      has_ground_truth: true,
    });
    mockFetchJobs.mockResolvedValue([job]);
    mockFetchInferenceHistory.mockResolvedValue([record]);
    mockFetchInferenceRecord.mockResolvedValue(record);

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });

    const onSelectJob = capturedSetupProps.onSelectJob as (id: string) => void;
    act(() => onSelectJob("job-1"));

    await waitFor(() => {
      expect(screen.getByTestId("results-with-gt")).toBeInTheDocument();
    });
  });

  it("auto-selects the latest inference when history loads", async () => {
    const job = makeJob({ job_id: "job-1" });
    const records = [
      makeInfRecord({ inf_id: "inf-latest" }),
      makeInfRecord({ inf_id: "inf-older" }),
    ];
    mockFetchJobs.mockResolvedValue([job]);
    mockFetchInferenceHistory.mockResolvedValue(records);
    mockFetchInferenceRecord.mockResolvedValue(
      makeInfRecord({ inf_id: "inf-latest" }),
    );

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });

    const onSelectJob = capturedSetupProps.onSelectJob as (id: string) => void;
    act(() => onSelectJob("job-1"));

    await waitFor(() => {
      expect(capturedSetupProps.selectedInfId).toBe("inf-latest");
    });
  });

  it("calls runInference mutation and shows success toast", async () => {
    const job = makeJob({ job_id: "job-1" });
    mockFetchJobs.mockResolvedValue([job]);
    mockRunInference.mockResolvedValue({
      inf_id: "inf-new",
      job_id: "job-1",
    });

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });

    // Select job first
    const onSelectJob = capturedSetupProps.onSelectJob as (id: string) => void;
    act(() => onSelectJob("job-1"));

    // Trigger inference run
    const onRunInference = capturedSetupProps.onRunInference as (params: {
      dataPath: string;
      sourceType: "path" | "upload";
      evaluate: boolean;
      returnShap: boolean;
    }) => void;
    await act(async () =>
      onRunInference({
        dataPath: "/data/test.csv",
        sourceType: "path",
        evaluate: false,
        returnShap: false,
      }),
    );

    await waitFor(() => {
      expect(mockRunInference).toHaveBeenCalledWith({
        job_id: "job-1",
        data: { source_type: "path", path: "/data/test.csv" },
        return_shap: false,
        evaluate: false,
      });
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("Inference completed");
    });
  });

  // Issue #374: Upload mode previously dropped sourceType somewhere
  // between SetupPanel and InferencePage so the request always carried
  // ``source_type: "path"``. The backend then rejected the upload
  // tempfile (under /tmp) against the home-rooted ALLOWED_FILES_ROOT.
  it("forwards source_type='upload' to /api/inference/run (Issue #374)", async () => {
    const job = makeJob({ job_id: "job-1" });
    mockFetchJobs.mockResolvedValue([job]);
    mockRunInference.mockResolvedValue({
      inf_id: "inf-up",
      job_id: "job-1",
    });

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });

    const onSelectJob = capturedSetupProps.onSelectJob as (id: string) => void;
    act(() => onSelectJob("job-1"));

    const onRunInference = capturedSetupProps.onRunInference as (params: {
      dataPath: string;
      sourceType: "path" | "upload";
      evaluate: boolean;
      returnShap: boolean;
    }) => void;
    await act(async () =>
      onRunInference({
        dataPath: "/tmp/lizystudio_abc.csv",
        sourceType: "upload",
        evaluate: true,
        returnShap: false,
      }),
    );

    await waitFor(() => {
      expect(mockRunInference).toHaveBeenCalledWith({
        job_id: "job-1",
        data: { source_type: "upload", path: "/tmp/lizystudio_abc.csv" },
        return_shap: false,
        evaluate: true,
      });
    });
  });

  it("shows error toast when inference fails", async () => {
    const job = makeJob({ job_id: "job-1" });
    mockFetchJobs.mockResolvedValue([job]);
    mockRunInference.mockRejectedValue(new Error("Model not found"));

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });

    const onSelectJob = capturedSetupProps.onSelectJob as (id: string) => void;
    act(() => onSelectJob("job-1"));

    const onRunInference = capturedSetupProps.onRunInference as (params: {
      dataPath: string;
      sourceType: "path" | "upload";
      evaluate: boolean;
      returnShap: boolean;
    }) => void;
    await act(async () =>
      onRunInference({
        dataPath: "/data/test.csv",
        sourceType: "path",
        evaluate: false,
        returnShap: false,
      }),
    );

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "Inference failed: Model not found",
      );
    });
  });

  it("passes isRunning=true while mutation is pending", async () => {
    const job = makeJob({ job_id: "job-1" });
    mockFetchJobs.mockResolvedValue([job]);

    // Never resolve to keep mutation pending
    mockRunInference.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<InferencePage />);

    await waitFor(() => {
      const jobs = capturedSetupProps.completedJobs as unknown[];
      expect(jobs).toHaveLength(1);
    });

    const onSelectJob = capturedSetupProps.onSelectJob as (id: string) => void;
    act(() => onSelectJob("job-1"));

    const onRunInference = capturedSetupProps.onRunInference as (params: {
      dataPath: string;
      sourceType: "path" | "upload";
      evaluate: boolean;
      returnShap: boolean;
    }) => void;
    act(() =>
      onRunInference({
        dataPath: "/data/test.csv",
        sourceType: "path",
        evaluate: false,
        returnShap: false,
      }),
    );

    await waitFor(() => {
      expect(capturedSetupProps.isRunning).toBe(true);
    });
  });
});
