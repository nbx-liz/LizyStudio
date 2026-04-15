import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    // Mock matchMedia for headless DOM environment
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
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("renders a button", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows 'Dark mode' label when expanded and theme is light", () => {
    render(<ThemeToggle collapsed={false} />);
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });

  it("does not show label when collapsed", () => {
    render(<ThemeToggle collapsed={true} />);
    expect(screen.queryByText("Dark mode")).toBeNull();
    expect(screen.queryByText("Light mode")).toBeNull();
  });

  it("toggles theme on click", () => {
    render(<ThemeToggle collapsed={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Light mode")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
