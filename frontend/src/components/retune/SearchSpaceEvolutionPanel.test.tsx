import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchSpaceEvolutionPanel } from "./SearchSpaceEvolutionPanel";
import type { BoundaryReport, TuneRound } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRound(
  round: number,
  snapshot: Record<string, unknown>[] | null | undefined,
  expanded_dims: string[] = [],
): TuneRound {
  return {
    round,
    n_trials: 50,
    best_score_before: null,
    best_score_after: 0.8,
    expanded_dims,
    space_snapshot: snapshot,
  };
}

const numericSnapshot = (low: number, high: number, name = "lr") => ({
  name,
  type: "float",
  category: "model",
  low,
  high,
  log: true,
});

const categoricalSnapshot = (choices: string[], name = "boosting") => ({
  name,
  type: "categorical",
  category: "model",
  choices,
});

const boundaryReport = (name: string, best: number | null): BoundaryReport => ({
  dims: [
    {
      name,
      best_value: best,
      low: null,
      high: null,
      position_pct: null,
      edge: "none",
      expanded: false,
      new_low: null,
      new_high: null,
    },
  ],
  expanded_names: [],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SearchSpaceEvolutionPanel", () => {
  it("renders one row per dimension with a bar for each round", () => {
    const rounds: TuneRound[] = [
      makeRound(1, [numericSnapshot(0.01, 0.1)]),
      makeRound(2, [numericSnapshot(0.001, 0.1)], ["lr"]),
      makeRound(3, [numericSnapshot(0.001, 0.1)]),
    ];

    render(
      <SearchSpaceEvolutionPanel
        rounds={rounds}
        boundaryReport={boundaryReport("lr", 0.05)}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /search space evolution/i }),
    ).toBeInTheDocument();

    // Dimension label is shown exactly once.
    expect(screen.getAllByText("lr")).toHaveLength(1);

    // Three round-bars are drawn.
    const bars = screen.getAllByTestId("evolution-bar");
    expect(bars).toHaveLength(3);

    // The expanded round is marked so the user can see which round widened
    // the range.
    const expandedBars = screen.getAllByLabelText(/expanded in round 2/i);
    expect(expandedBars.length).toBeGreaterThanOrEqual(1);
  });

  it("shows a single bar for a single-round tune", () => {
    const rounds: TuneRound[] = [makeRound(1, [numericSnapshot(0.01, 0.1)])];

    render(
      <SearchSpaceEvolutionPanel
        rounds={rounds}
        boundaryReport={boundaryReport("lr", 0.05)}
      />,
    );

    expect(screen.getAllByTestId("evolution-bar")).toHaveLength(1);
  });

  it("returns null when no round carries a space_snapshot", () => {
    const rounds: TuneRound[] = [makeRound(1, null), makeRound(2, undefined)];

    const { container } = render(
      <SearchSpaceEvolutionPanel rounds={rounds} boundaryReport={null} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("handles dimensions that appear in a later round only", () => {
    const rounds: TuneRound[] = [
      makeRound(1, [numericSnapshot(0.01, 0.1, "lr")]),
      makeRound(2, [
        numericSnapshot(0.01, 0.1, "lr"),
        numericSnapshot(10, 100, "num_leaves"),
      ]),
    ];

    render(<SearchSpaceEvolutionPanel rounds={rounds} boundaryReport={null} />);

    const lrRow = screen.getByTestId("evolution-row-lr");
    const numLeavesRow = screen.getByTestId("evolution-row-num_leaves");

    // lr appears in both rounds, num_leaves only in round 2. The panel shows
    // a placeholder for the round where the dim was absent so the timeline
    // stays aligned.
    expect(within(lrRow).getAllByTestId("evolution-bar")).toHaveLength(2);
    expect(within(numLeavesRow).getAllByTestId("evolution-bar")).toHaveLength(
      1,
    );
    expect(
      within(numLeavesRow).getByText(/not tuned in round 1/i),
    ).toBeInTheDocument();
  });

  it("renders categorical dimensions as choice lists, not bars", () => {
    const rounds: TuneRound[] = [
      makeRound(1, [categoricalSnapshot(["gbdt"])]),
      makeRound(2, [categoricalSnapshot(["gbdt", "dart"])], ["boosting"]),
    ];

    render(<SearchSpaceEvolutionPanel rounds={rounds} boundaryReport={null} />);

    const row = screen.getByTestId("evolution-row-boosting");
    // No numeric bars for categorical dims.
    expect(within(row).queryByTestId("evolution-bar")).toBeNull();
    // gbdt appears in both rounds, dart only in round 2.
    expect(within(row).getAllByText(/gbdt/)).toHaveLength(2);
    expect(within(row).getAllByText(/dart/)).toHaveLength(1);
  });
});
