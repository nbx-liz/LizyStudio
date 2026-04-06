import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";

describe("AppLayout", () => {
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

  it("renders children", () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>test content</div>
        </AppLayout>
      </MemoryRouter>,
    );
    expect(screen.getByText("test content")).toBeInTheDocument();
  });

  it("renders sidebar with navigation", () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>page</div>
        </AppLayout>
      </MemoryRouter>,
    );
    expect(screen.getByText("LizyStudio")).toBeInTheDocument();
  });

  it("renders main element for content area", () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>main content</div>
        </AppLayout>
      </MemoryRouter>,
    );
    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(main).toHaveTextContent("main content");
  });

  it("renders multiple children", () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>first</div>
          <div>second</div>
        </AppLayout>
      </MemoryRouter>,
    );
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});
