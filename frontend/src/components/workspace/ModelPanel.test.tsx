import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPanel } from "./ModelPanel";

vi.mock("@/api/workspace", () => ({
  fetchConfigSchema: vi.fn().mockResolvedValue({ properties: {}, $defs: {} }),
  fetchConfig: vi
    .fn()
    .mockResolvedValue({ model: { name: "lgbm", params: {} } }),
  fetchBackends: vi
    .fn()
    .mockResolvedValue([{ name: "lizyml", version: "0.4.0" }]),
  fetchUiSchema: vi.fn().mockResolvedValue(null),
  fetchColumns: vi.fn().mockResolvedValue({ columns: [] }),
  updateConfig: vi.fn().mockResolvedValue(undefined),
  validateConfig: vi.fn().mockResolvedValue({ errors: [] }),
  uploadConfig: vi.fn(),
  getConfigDownloadUrl: vi
    .fn()
    .mockReturnValue("/api/workspace/config/download"),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("ModelPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders Fit and Tune tabs", () => {
    renderWithQuery(
      <ModelPanel
        hasData={true}
        task="binary"
        onFit={vi.fn()}
        onTune={vi.fn()}
        running={false}
      />,
    );
    expect(screen.getByRole("tab", { name: "Fit" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tune" })).toBeInTheDocument();
  });

  it("renders Fit/Tune action button", () => {
    renderWithQuery(
      <ModelPanel
        hasData={true}
        task="binary"
        onFit={vi.fn()}
        onTune={vi.fn()}
        running={false}
      />,
    );
    // The action button text matches the active tab (defaults to "Fit")
    const buttons = screen.getAllByRole("button", { name: /Fit/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Import YAML, Export YAML, Raw Config buttons", () => {
    renderWithQuery(
      <ModelPanel
        hasData={true}
        task="binary"
        onFit={vi.fn()}
        onTune={vi.fn()}
        running={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Import YAML/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Export YAML/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Raw Config/i }),
    ).toBeInTheDocument();
  });

  it("Fit button is disabled when hasData is false", () => {
    renderWithQuery(
      <ModelPanel
        hasData={false}
        task="binary"
        onFit={vi.fn()}
        onTune={vi.fn()}
        running={false}
      />,
    );
    // The action button (not the tab) should be disabled
    const actionButtons = screen
      .getAllByRole("button")
      .filter(
        (btn) => btn.textContent === "Fit" && !btn.closest('[role="tablist"]'),
      );
    expect(actionButtons.length).toBe(1);
    expect(actionButtons[0]).toBeDisabled();
  });

  it("shows Loading config... initially (before queries resolve)", () => {
    // Use a QueryClient where queries will remain pending
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          // Disable automatic fetching so data stays undefined
          enabled: false,
        },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ModelPanel
          hasData={true}
          task="binary"
          onFit={vi.fn()}
          onTune={vi.fn()}
          running={false}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Loading config...")).toBeInTheDocument();
  });
});
