import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoundaryExpansionPanel } from "./BoundaryExpansionPanel";
import type { BoundaryDimStatus, BoundaryReport } from "./types";

const baseDim: BoundaryDimStatus = {
  name: "learning_rate",
  best_value: 0.05,
  low: 0.001,
  high: 0.1,
  // lizyml emits position_pct in [0.0, 1.0]; UI multiplies by 100 for display.
  position_pct: 0.495,
  edge: "none",
  expanded: false,
  new_low: null,
  new_high: null,
  clamped_to_bound: false,
};

function makeReport(dims: BoundaryDimStatus[]): BoundaryReport {
  return {
    dims,
    expanded_names: dims.filter((d) => d.expanded).map((d) => d.name),
  };
}

describe("BoundaryExpansionPanel", () => {
  it("returns null when report is null", () => {
    const { container } = render(<BoundaryExpansionPanel report={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when report is undefined", () => {
    const { container } = render(<BoundaryExpansionPanel report={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders empty state when dims is empty", () => {
    render(<BoundaryExpansionPanel report={makeReport([])} />);
    expect(screen.getByText(/no boundary tracking data/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a row per dimension", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([
          { ...baseDim, name: "lr" },
          { ...baseDim, name: "num_leaves", best_value: 340 },
        ])}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    // 1 header + 2 data rows
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("highlights expanded rows and marks them via aria-label", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([
          { ...baseDim, name: "lr", expanded: true, edge: "lower" },
          { ...baseDim, name: "num_leaves", expanded: false },
        ])}
      />,
    );
    const lrRow = screen.getByLabelText(/lr — expanded/i);
    expect(lrRow.className).toContain("border-l-primary");
  });

  it("shows Yes badge for expanded, No text otherwise", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([
          { ...baseDim, name: "a", expanded: true },
          { ...baseDim, name: "b", expanded: false },
        ])}
      />,
    );
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("renders em-dash range when low/high missing", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([{ ...baseDim, low: null, high: null }])}
      />,
    );
    // The em-dash is used both for range fallback and elsewhere; at least one exists
    expect(screen.getAllByText(/\u2014/).length).toBeGreaterThan(0);
  });

  it("renders edge symbol for upper/lower/none", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([
          { ...baseDim, name: "a", edge: "upper", expanded: true },
          { ...baseDim, name: "b", edge: "lower", expanded: true },
          { ...baseDim, name: "c", edge: "none" },
        ])}
      />,
    );
    expect(screen.getByText("\u25b2")).toBeInTheDocument();
    expect(screen.getByText("\u25bc")).toBeInTheDocument();
    expect(screen.getByText("\u2013")).toBeInTheDocument();
  });

  it("renders a 'bounded' badge for dims clamped by parameter_bounds", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([
          { ...baseDim, name: "lr", clamped_to_bound: true, expanded: true },
          { ...baseDim, name: "num_leaves", clamped_to_bound: false },
        ])}
      />,
    );
    const badges = screen.getAllByText(/^bounded$/i);
    expect(badges).toHaveLength(1);
  });

  it("renders categorical best_value as its string representation", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([
          {
            ...baseDim,
            name: "optimizer",
            best_value: "adam",
            low: null,
            high: null,
          },
        ])}
      />,
    );
    expect(screen.getByText("adam")).toBeInTheDocument();
  });

  it("renders 0% position when position_pct is exactly 0", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([{ ...baseDim, position_pct: 0 }])}
      />,
    );
    // Both md+ and md- variants render a literal "0%"
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
  });

  it("scales lizyml's [0,1] position_pct to a 0-100 percentage label", () => {
    // 0.732 → 73% (matches end-to-end run with learning_rate at edge=none)
    render(
      <BoundaryExpansionPanel
        report={makeReport([{ ...baseDim, position_pct: 0.732 }])}
      />,
    );
    expect(screen.getAllByText("73%").length).toBeGreaterThan(0);
    expect(screen.queryByText("1%")).not.toBeInTheDocument();
  });

  it("renders em-dash for best_value when it is null", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([{ ...baseDim, best_value: null }])}
      />,
    );
    expect(screen.getAllByText("\u2014").length).toBeGreaterThan(0);
  });

  it("renders em-dash instead of '—%' when position_pct is null", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([{ ...baseDim, position_pct: null }])}
      />,
    );
    // No bare "%" sign should appear next to a dash.
    expect(screen.queryByText(/\u2014%/)).not.toBeInTheDocument();
    // At least one em-dash still present (range or position fallback).
    expect(screen.getAllByText(/\u2014/).length).toBeGreaterThan(0);
  });
});
