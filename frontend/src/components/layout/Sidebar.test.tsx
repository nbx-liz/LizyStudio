import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
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
    localStorage.clear();
  });

  it("renders LizyStudio branding", () => {
    renderSidebar();
    expect(screen.getByText("LizyStudio")).toBeInTheDocument();
  });

  it("renders navigation links", () => {
    renderSidebar();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Jobs")).toBeInTheDocument();
    expect(screen.getByText("Inference")).toBeInTheDocument();
  });

  it("renders Collapse button", () => {
    renderSidebar();
    expect(screen.getByText("Collapse")).toBeInTheDocument();
  });

  it("hides labels when collapsed", () => {
    renderSidebar();
    fireEvent.click(screen.getByText("Collapse"));
    expect(screen.queryByText("LizyStudio")).toBeNull();
    expect(screen.queryByText("Workspace")).toBeNull();
  });
});
