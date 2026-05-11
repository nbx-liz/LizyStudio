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
      clamped_to_bound: false,
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

  it("returns null when rounds is an empty array and boundaryReport is null", () => {
    const { container } = render(
      <RetuneDashboard rounds={[]} boundaryReport={null} />,
    );
    expect(container.firstChild).toBeNull();
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

  it("shows Search Space Evolution when any round carries a snapshot", () => {
    const withSnapshot: TuneRound[] = [
      {
        ...rounds[0],
        space_snapshot: [
          {
            name: "lr",
            type: "float",
            category: "model",
            low: 0.01,
            high: 0.1,
            log: true,
          },
        ],
      },
      rounds[1],
    ];
    render(
      <RetuneDashboard rounds={withSnapshot} boundaryReport={boundaryReport} />,
    );
    expect(
      screen.getByRole("heading", { name: /search space evolution/i }),
    ).toBeInTheDocument();
  });

  it("hides Search Space Evolution when no round carries a snapshot", () => {
    render(<RetuneDashboard rounds={rounds} boundaryReport={boundaryReport} />);
    expect(
      screen.queryByRole("heading", { name: /search space evolution/i }),
    ).not.toBeInTheDocument();
  });
});
