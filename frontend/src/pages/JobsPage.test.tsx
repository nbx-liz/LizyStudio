import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobsPage } from "./JobsPage";

// --- API mocks ---

const mockFetchJobs = vi.fn().mockResolvedValue([]);

vi.mock("@/api/jobs", () => ({
  fetchJobs: (...args: unknown[]) => mockFetchJobs(...args),
  fetchJob: vi.fn(),
  cancelJob: vi.fn(),
  deleteJob: vi.fn(),
  exportJob: vi.fn(),
  fetchJobLog: vi.fn(),
}));

vi.mock("@/api/websocket", () => ({
  connectJobProgress: vi.fn().mockReturnValue(() => {}),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// --- Child component mocks that capture props ---

let capturedJobListProps: Record<string, unknown> = {};
let capturedJobDetailProps: Record<string, unknown> = {};

vi.mock("@/components/jobs/JobList", () => ({
  JobList: (props: Record<string, unknown>) => {
    capturedJobListProps = props;
    return (
      <div data-testid="job-list">
        JobList ({(props.jobs as unknown[]).length} jobs)
      </div>
    );
  },
}));

vi.mock("@/components/jobs/JobDetail", () => ({
  JobDetailPanel: (props: Record<string, unknown>) => {
    capturedJobDetailProps = props;
    return (
      <div data-testid="job-detail">JobDetail: {props.jobId as string}</div>
    );
  },
}));

// --- Test data factories ---

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    job_id: "job-1",
    job_type: "fit",
    status: "completed",
    backend_name: "lizyml",
    model_name: "LGBMClassifier",
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:10:00Z",
    error: null,
    primary_score: 0.95,
    ...overrides,
  };
}

// --- Helpers ---

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

// --- Tests ---

describe("JobsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedJobListProps = {};
    capturedJobDetailProps = {};

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

  it("renders the page with job list and placeholder when no jobs", async () => {
    renderWithProviders(<JobsPage />);
    expect(screen.getByTestId("job-list")).toBeInTheDocument();
    expect(
      screen.getByText("Select a job to view details"),
    ).toBeInTheDocument();
  });

  it("renders the job list panel text", () => {
    renderWithProviders(<JobsPage />);
    expect(screen.getByText(/JobList/)).toBeInTheDocument();
  });

  it("passes loaded jobs to JobList", async () => {
    const jobs = [makeJob({ job_id: "job-1" }), makeJob({ job_id: "job-2" })];
    mockFetchJobs.mockResolvedValue(jobs);

    renderWithProviders(<JobsPage />);

    await waitFor(() => {
      const passedJobs = capturedJobListProps.jobs as unknown[];
      expect(passedJobs).toHaveLength(2);
    });
  });

  it("auto-selects the latest job on first load", async () => {
    const jobs = [
      makeJob({ job_id: "job-latest" }),
      makeJob({ job_id: "job-older" }),
    ];
    mockFetchJobs.mockResolvedValue(jobs);

    renderWithProviders(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("job-detail")).toBeInTheDocument();
    });
    expect(screen.getByText("JobDetail: job-latest")).toBeInTheDocument();
  });

  it("shows JobDetail when a job is selected via callback", async () => {
    const jobs = [makeJob({ job_id: "job-1" }), makeJob({ job_id: "job-2" })];
    mockFetchJobs.mockResolvedValue(jobs);

    renderWithProviders(<JobsPage />);

    // Wait for auto-selection
    await waitFor(() => {
      expect(screen.getByTestId("job-detail")).toBeInTheDocument();
    });

    // Simulate selecting a different job via JobList callback
    const onSelectJob = capturedJobListProps.onSelectJob as (
      id: string,
    ) => void;
    act(() => onSelectJob("job-2"));

    await waitFor(() => {
      expect(screen.getByText("JobDetail: job-2")).toBeInTheDocument();
    });
  });

  it("computes correct job number for selected job", async () => {
    const jobs = [
      makeJob({ job_id: "job-a" }),
      makeJob({ job_id: "job-b" }),
      makeJob({ job_id: "job-c" }),
    ];
    mockFetchJobs.mockResolvedValue(jobs);

    renderWithProviders(<JobsPage />);

    // Auto-selects job-a (index 0), number = 3 - 0 = 3
    await waitFor(() => {
      expect(capturedJobDetailProps.jobNumber).toBe(3);
    });

    // Select job-c (index 2), number = 3 - 2 = 1
    const onSelectJob = capturedJobListProps.onSelectJob as (
      id: string,
    ) => void;
    act(() => onSelectJob("job-c"));

    await waitFor(() => {
      expect(capturedJobDetailProps.jobNumber).toBe(1);
    });
  });

  it("invokes query invalidation on job deletion", async () => {
    const jobs = [makeJob({ job_id: "job-1" })];
    mockFetchJobs.mockResolvedValue(jobs);

    renderWithProviders(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("job-detail")).toBeInTheDocument();
    });

    // Verify the callback is a function and can be called
    const onJobDeleted = capturedJobDetailProps.onJobDeleted as () => void;
    expect(typeof onJobDeleted).toBe("function");

    // After deletion returns empty, the refetched data drives the UI
    mockFetchJobs.mockResolvedValue([]);
    act(() => onJobDeleted());

    // The deletion triggers a refetch; when empty jobs arrive,
    // the placeholder should appear
    await waitFor(() => {
      expect(screen.getByText(/0 jobs/)).toBeInTheDocument();
    });
  });
});
