import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobsPage } from "./JobsPage";

// --- Mocks ---

vi.mock("@/api/jobs", () => ({
  fetchJobs: vi.fn().mockResolvedValue([]),
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

// Mock child components to isolate page-level behavior
vi.mock("@/components/jobs/JobList", () => ({
  JobList: ({
    jobs,
    selectedJobId,
    onSelectJob,
  }: {
    jobs: unknown[];
    selectedJobId: string | null;
    onSelectJob: (id: string) => void;
  }) => <div data-testid="job-list">JobList ({jobs.length} jobs)</div>,
}));

vi.mock("@/components/jobs/JobDetail", () => ({
  JobDetailPanel: ({ jobId }: { jobId: string }) => (
    <div data-testid="job-detail">JobDetail: {jobId}</div>
  ),
}));

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
});
