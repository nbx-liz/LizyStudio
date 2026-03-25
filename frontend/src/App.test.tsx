import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// matchMedia mock for components that depend on media queries
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

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual };
});

// Mock heavy child pages to avoid deep rendering
vi.mock("./pages/WorkspacePage", () => ({
  WorkspacePage: () => <div data-testid="workspace-page">WorkspacePage</div>,
}));
vi.mock("./pages/JobsPage", () => ({
  JobsPage: () => <div data-testid="jobs-page">JobsPage</div>,
}));
vi.mock("./pages/InferencePage", () => ({
  InferencePage: () => <div data-testid="inference-page">InferencePage</div>,
}));
vi.mock("./components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));
vi.mock("sonner", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders without crashing", () => {
    render(<App />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("renders the workspace page at root path", () => {
    render(<App />);
    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
  });
});
