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

    expect(onFit).toHaveBeenCalledTimes(1);
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

  it("includes Tune command when onTune is provided", () => {
    renderPalette({ onTune: vi.fn() });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByText("Run Tune")).toBeInTheDocument();
  });

  it("calls onTune action and closes on Run Tune click", () => {
    const onTune = vi.fn();
    renderPalette({ onTune });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    fireEvent.click(screen.getByText("Run Tune"));

    expect(onTune).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText("Type a command...")).toBeNull();
  });

  it("shows Toggle Dark Mode command", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByText("Toggle Dark Mode")).toBeInTheDocument();
  });

  it("clicking Toggle Dark Mode calls action and closes palette", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    fireEvent.click(screen.getByText("Toggle Dark Mode"));

    expect(screen.queryByPlaceholderText("Type a command...")).toBeNull();
  });

  it("closing palette via Escape clears the search query", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "jobs" } });
    expect(input).toHaveValue("jobs");

    // Close by pressing Escape
    fireEvent.keyDown(input, { key: "Escape" });

    // Re-open and check query is cleared
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("Type a command...")).toHaveValue("");
  });

  it("Ctrl+K toggles palette closed when already open", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      screen.getByPlaceholderText("Type a command..."),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByPlaceholderText("Type a command...")).toBeNull();
  });
});
