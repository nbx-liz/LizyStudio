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
});
