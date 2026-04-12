import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RetuneDashboard } from "./RetuneDashboard";
import type { BoundaryReport, TuneRound } from "./types";

const rounds: TuneRound[] = [
  {
    round: 1,
    n_trials: 50,
    best_score_before: null,
    best_score_after: 0.8,
    expanded_dims: [],
  },
  {
    round: 2,
    n_trials: 20,
    best_score_before: 0.8,
    best_score_after: 0.8005,
    expanded_dims: [],
  },
];

const boundaryReport: BoundaryReport = {
  dims: [
    {
      name: "lr",
      best_value: 0.05,
      low: 0.001,
      high: 0.1,
      position_pct: 49,
      edge: "none",
      expanded: false,
      new_low: null,
      new_high: null,
    },
  ],
  expanded_names: [],
};

describe("RetuneDashboard", () => {
  it("returns null when all inputs are missing", () => {
    const { container } = render(
      <RetuneDashboard rounds={null} boundaryReport={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides ConvergenceSignalPanel when rounds.length < 2", () => {
    render(<RetuneDashboard rounds={[rounds[0]]} boundaryReport={null} />);
    // RoundHistory still renders
    expect(
      screen.getByRole("heading", { name: /round history/i }),
    ).toBeInTheDocument();
    // No convergence banner
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders all three sections when data is complete", () => {
    render(<RetuneDashboard rounds={rounds} boundaryReport={boundaryReport} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /round history/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /boundary report/i }),
    ).toBeInTheDocument();
  });

  it("renders only boundary panel when rounds are null", () => {
    render(<RetuneDashboard rounds={null} boundaryReport={boundaryReport} />);
    expect(
      screen.getByRole("heading", { name: /boundary report/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /round history/i }),
    ).not.toBeInTheDocument();
  });
});
