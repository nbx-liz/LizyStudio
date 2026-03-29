import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Onboarding } from "./Onboarding";

const STORAGE_KEY = "lizystudio-onboarding-completed";

describe("Onboarding", () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("shows onboarding dialog on first visit", () => {
    render(<Onboarding />);
    expect(screen.getByText("Welcome to LizyStudio")).toBeInTheDocument();
  });

  it("does not show when already completed", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    render(<Onboarding />);
    expect(screen.queryByText("Welcome to LizyStudio")).toBeNull();
  });

  it("navigates through steps with Next button", () => {
    render(<Onboarding />);

    expect(screen.getByText("Welcome to LizyStudio")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("1. Load Your Data")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("2. Configure Your Model")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("3. Run & Analyze")).toBeInTheDocument();
  });

  it("closes and persists on Get Started", () => {
    render(<Onboarding />);

    // Navigate to last step
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Get Started"));

    expect(screen.queryByText("3. Run & Analyze")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("closes and persists on Skip", () => {
    render(<Onboarding />);
    fireEvent.click(screen.getByText("Skip"));

    expect(screen.queryByText("Welcome to LizyStudio")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });
});
