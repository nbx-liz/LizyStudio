import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";

// --- API mocks ---

const {
  mockFetchUiSchema,
  mockRunFit,
  mockRunTune,
  mockUpdateConfig,
  mockToast,
} = vi.hoisted(() => ({
  mockFetchUiSchema: vi.fn().mockResolvedValue(null),
  mockRunFit: vi.fn(),
  mockRunTune: vi.fn(),
  mockUpdateConfig: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/api/workspace", () => ({
  fetchUiSchema: (...args: unknown[]) => mockFetchUiSchema(...args),
  runFit: (...args: unknown[]) => mockRunFit(...args),
  runTune: (...args: unknown[]) => mockRunTune(...args),
  updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

// Mock react-resizable-panels (doesn't work in jsdom)
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div data-testid="handle" />,
}));

// --- Child component mocks that capture props ---

let capturedDataPanelProps: Record<string, unknown> = {};
let capturedModelPanelProps: Record<string, unknown> = {};
let capturedResultsPanelProps: Record<string, unknown> = {};

vi.mock("@/components/workspace/DataPanel", () => ({
  DataPanel: (props: Record<string, unknown>) => {
    capturedDataPanelProps = props;
    return <div data-testid="data-panel">DataPanel</div>;
  },
}));
vi.mock("@/components/workspace/ModelPanel", () => ({
  ModelPanel: (props: Record<string, unknown>) => {
    capturedModelPanelProps = props;
    return <div data-testid="model-panel">ModelPanel</div>;
  },
}));
vi.mock("@/components/workspace/ResultsPanel", () => ({
  ResultsPanel: (props: Record<string, unknown>) => {
    capturedResultsPanelProps = props;
    return <div data-testid="results-panel">ResultsPanel</div>;
  },
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

describe("WorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDataPanelProps = {};
    capturedModelPanelProps = {};
    capturedResultsPanelProps = {};

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

  it("renders the 3-panel structure", () => {
    renderWithProviders(<WorkspacePage />);
    expect(screen.getByTestId("data-panel")).toBeInTheDocument();
    expect(screen.getByTestId("model-panel")).toBeInTheDocument();
    expect(screen.getByTestId("results-panel")).toBeInTheDocument();
  });

  it("renders all three panels with expected text", () => {
    renderWithProviders(<WorkspacePage />);
    expect(screen.getByText("DataPanel")).toBeInTheDocument();
    expect(screen.getByText("ModelPanel")).toBeInTheDocument();
    expect(screen.getByText("ResultsPanel")).toBeInTheDocument();
  });

  it("passes running=false initially to ModelPanel", () => {
    renderWithProviders(<WorkspacePage />);
    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("sets running=true when handleFit is called", async () => {
    mockRunFit.mockResolvedValue({ job_id: "job-fit-1" });
    renderWithProviders(<WorkspacePage />);

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());

    expect(capturedModelPanelProps.running).toBe(true);
  });

  it("sets running=true when handleTune is called", async () => {
    mockRunTune.mockResolvedValue({ job_id: "job-tune-1" });
    renderWithProviders(<WorkspacePage />);

    const onTune = capturedModelPanelProps.onTune as () => Promise<void>;
    await act(async () => onTune());

    expect(capturedModelPanelProps.running).toBe(true);
  });

  it("shows error toast and resets running on fit failure", async () => {
    mockRunFit.mockRejectedValue(new Error("No data loaded"));
    renderWithProviders(<WorkspacePage />);

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());

    expect(mockToast.error).toHaveBeenCalledWith("Fit failed: No data loaded");
    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("shows error toast and resets running on tune failure", async () => {
    mockRunTune.mockRejectedValue(new Error("Invalid config"));
    renderWithProviders(<WorkspacePage />);

    const onTune = capturedModelPanelProps.onTune as () => Promise<void>;
    await act(async () => onTune());

    expect(mockToast.error).toHaveBeenCalledWith("Tune failed: Invalid config");
    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("passes job_id to ResultsPanel after successful fit", async () => {
    mockRunFit.mockResolvedValue({ job_id: "job-new" });
    renderWithProviders(<WorkspacePage />);

    expect(capturedResultsPanelProps.jobId).toBeNull();

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());

    expect(capturedResultsPanelProps.jobId).toBe("job-new");
  });

  it("resets running via onJobDone callback", async () => {
    mockRunFit.mockResolvedValue({ job_id: "job-1" });
    renderWithProviders(<WorkspacePage />);

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());
    expect(capturedModelPanelProps.running).toBe(true);

    // Simulate job completion via ResultsPanel callback
    const onJobDone = capturedResultsPanelProps.onJobDone as () => void;
    act(() => onJobDone());

    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("updates hasData when onDataChanged is called", () => {
    renderWithProviders(<WorkspacePage />);

    expect(capturedModelPanelProps.hasData).toBe(false);

    const onDataChanged = capturedDataPanelProps.onDataChanged as () => void;
    act(() => onDataChanged());

    expect(capturedModelPanelProps.hasData).toBe(true);
  });

  it("handles applyToFit with success toast", async () => {
    mockUpdateConfig.mockResolvedValue({});
    renderWithProviders(<WorkspacePage />);

    const onApplyToFit = capturedResultsPanelProps.onApplyToFit as (
      config: Record<string, unknown>,
    ) => Promise<void>;
    await act(async () => onApplyToFit({ model: { name: "LGBMClassifier" } }));

    expect(mockUpdateConfig).toHaveBeenCalledWith({
      model: { name: "LGBMClassifier" },
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Tune config with best params applied",
    );
  });

  it("handles applyToFit failure with error toast", async () => {
    mockUpdateConfig.mockRejectedValue(new Error("Server error"));
    renderWithProviders(<WorkspacePage />);

    const onApplyToFit = capturedResultsPanelProps.onApplyToFit as (
      config: Record<string, unknown>,
    ) => Promise<void>;
    await act(async () => onApplyToFit({}));

    expect(mockToast.error).toHaveBeenCalledWith("Failed to apply tune config");
  });
});
