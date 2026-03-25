import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";

// --- Mocks ---

vi.mock("@/api/workspace", () => ({
  fetchUiSchema: vi.fn().mockResolvedValue(null),
  runFit: vi.fn(),
  runTune: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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

// Mock child panels to isolate the page layout
vi.mock("@/components/workspace/DataPanel", () => ({
  DataPanel: (props: Record<string, unknown>) => (
    <div data-testid="data-panel">DataPanel</div>
  ),
}));
vi.mock("@/components/workspace/ModelPanel", () => ({
  ModelPanel: (props: Record<string, unknown>) => (
    <div data-testid="model-panel">ModelPanel</div>
  ),
}));
vi.mock("@/components/workspace/ResultsPanel", () => ({
  ResultsPanel: (props: Record<string, unknown>) => (
    <div data-testid="results-panel">ResultsPanel</div>
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

describe("WorkspacePage", () => {
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
});
