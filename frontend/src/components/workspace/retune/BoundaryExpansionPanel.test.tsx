import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoundaryExpansionPanel } from "./BoundaryExpansionPanel";
import type { BoundaryDimStatus, BoundaryReport } from "./types";

const baseDim: BoundaryDimStatus = {
  name: "learning_rate",
  best_value: 0.05,
  low: 0.001,
  high: 0.1,
  position_pct: 49.5,
  edge: "none",
  expanded: false,
  new_low: null,
  new_high: null,
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

  it("renders edge symbol for upper/lower/none/mid", () => {
    render(
      <BoundaryExpansionPanel
        report={makeReport([
          { ...baseDim, name: "a", edge: "upper", expanded: true },
          { ...baseDim, name: "b", edge: "lower", expanded: true },
          { ...baseDim, name: "c", edge: "none" },
          { ...baseDim, name: "d", edge: "mid" },
        ])}
      />,
    );
    expect(screen.getByText("\u25b2")).toBeInTheDocument();
    expect(screen.getByText("\u25bc")).toBeInTheDocument();
    // Both "none" and "mid" rows fall through to the dash glyph.
    expect(screen.getAllByText("\u2013")).toHaveLength(2);
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
