import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

function renderPalette(
  props: { onFit?: () => void; onTune?: () => void } = {},
) {
  return render(
    <MemoryRouter>
      <CommandPalette {...props} />
    </MemoryRouter>,
  );
}

describe("CommandPalette", () => {
  it("opens on Ctrl+K", () => {
    renderPalette();

    // Initially no dialog content
    expect(screen.queryByPlaceholderText("Type a command...")).toBeNull();

    // Simulate Ctrl+K
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(
      screen.getByPlaceholderText("Type a command..."),
    ).toBeInTheDocument();
  });

  it("shows navigation commands", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByText("Go to Workspace")).toBeInTheDocument();
    expect(screen.getByText("Go to Jobs")).toBeInTheDocument();
    expect(screen.getByText("Go to Inference")).toBeInTheDocument();
  });

  it("filters commands by query", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "jobs" } });

    expect(screen.getByText("Go to Jobs")).toBeInTheDocument();
    expect(screen.queryByText("Go to Workspace")).toBeNull();
  });

  it("includes Fit command when onFit is provided", () => {
    renderPalette({ onFit: vi.fn() });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByText("Run Fit")).toBeInTheDocument();
  });

  it("does not include Fit command when onFit is not provided", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.queryByText("Run Fit")).toBeNull();
  });

  it("calls action and closes on command click", () => {
    const onFit = vi.fn();
    renderPalette({ onFit });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    fireEvent.click(screen.getByText("Run Fit"));

    expect(onFit).toHaveBeenCalled();
    // Dialog should be closed (no input visible)
    expect(screen.queryByPlaceholderText("Type a command...")).toBeNull();
  });

  it("shows 'No commands found' for non-matching query", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "xyznonexistent" } });

    expect(screen.getByText("No commands found")).toBeInTheDocument();
  });
});
