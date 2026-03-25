import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InferencePage } from "./InferencePage";

// --- Mocks ---

vi.mock("@/api/inference", () => ({
  fetchInferenceHistory: vi.fn().mockResolvedValue([]),
  fetchInferenceRecord: vi.fn().mockResolvedValue(null),
  runInference: vi.fn(),
  uploadInferenceData: vi.fn(),
  fetchInferencePredictions: vi.fn(),
  fetchInferenceMetrics: vi.fn(),
  fetchInferencePlot: vi.fn(),
  getInferenceDownloadUrl: vi.fn().mockReturnValue(""),
  fetchInferenceShapPlot: vi.fn(),
  fetchInferenceComparison: vi.fn(),
}));

vi.mock("@/api/jobs", () => ({
  fetchJobs: vi.fn().mockResolvedValue([]),
  fetchJob: vi.fn(),
  cancelJob: vi.fn(),
  deleteJob: vi.fn(),
  exportJob: vi.fn(),
  fetchJobLog: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mock child components
vi.mock("@/components/inference/SetupPanel", () => ({
  SetupPanel: (props: Record<string, unknown>) => (
    <div data-testid="setup-panel">SetupPanel</div>
  ),
}));
vi.mock("@/components/inference/ResultsWithGT", () => ({
  ResultsWithGT: (props: Record<string, unknown>) => (
    <div data-testid="results-with-gt">ResultsWithGT</div>
  ),
}));
vi.mock("@/components/inference/ResultsPredOnly", () => ({
  ResultsPredOnly: (props: Record<string, unknown>) => (
    <div data-testid="results-pred-only">ResultsPredOnly</div>
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

describe("InferencePage", () => {
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

  it("renders the page with setup panel and placeholder text", () => {
    renderWithProviders(<InferencePage />);
    expect(screen.getByTestId("setup-panel")).toBeInTheDocument();
    expect(
      screen.getByText("Select a model to get started"),
    ).toBeInTheDocument();
  });

  it("renders the two-panel layout structure", () => {
    renderWithProviders(<InferencePage />);
    // SetupPanel is in the left panel, placeholder in the right
    expect(screen.getByTestId("setup-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("results-with-gt")).not.toBeInTheDocument();
    expect(screen.queryByTestId("results-pred-only")).not.toBeInTheDocument();
  });
});
