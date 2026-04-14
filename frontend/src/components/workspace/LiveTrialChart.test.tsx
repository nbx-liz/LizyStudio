import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrialResult } from "@/api/types";
import { LiveTrialChart } from "./LiveTrialChart";

// PlotlyChart imports plotly.js which is heavy and not needed here.
// Mock it so we can read the serialized plot spec from a data attribute.
vi.mock("./PlotlyChart", () => ({
  PlotlyChart: ({
    plotlyJson,
    height,
  }: {
    plotlyJson: string;
    height: number;
  }) => (
    <div
      data-testid="plotly-chart"
      data-height={height}
      data-plot={plotlyJson}
    />
  ),
}));

function trial(
  number: number,
  score: number | null,
  best: number | null,
  state = "complete",
): TrialResult {
  return { number, score, state, best_score: best };
}

type PlotTrace = {
  name: string;
  x: number[];
  y: number[];
  mode: string;
  type: string;
};

type PlotSpec = {
  data: PlotTrace[];
  layout: Record<string, unknown>;
};

function readPlot(): PlotSpec {
  const el = screen.getByTestId("plotly-chart");
  return JSON.parse(el.getAttribute("data-plot") ?? "null") as PlotSpec;
}

describe("LiveTrialChart", () => {
  it("returns null when fewer than 2 valid trials are provided", () => {
    const { container } = render(
      <LiveTrialChart trials={[trial(0, 0.9, 0.9)]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("filters out trials with null score before counting", () => {
    // Only one valid trial after filter → still null.
    const { container } = render(
      <LiveTrialChart
        trials={[trial(0, null, null, "pruned"), trial(1, 0.9, 0.9)]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders both Score and Best traces when >= 2 valid trials", () => {
    render(
      <LiveTrialChart trials={[trial(0, 0.81, 0.81), trial(1, 0.85, 0.85)]} />,
    );
    const plot = readPlot();
    expect(plot.data).toHaveLength(2);
    const score = plot.data.find((d) => d.name === "Score");
    const best = plot.data.find((d) => d.name === "Best");
    expect(score).toBeDefined();
    expect(best).toBeDefined();
    if (!score || !best) throw new Error("trace not found");
    expect(score.x).toEqual([0, 1]);
    expect(score.y).toEqual([0.81, 0.85]);
    expect(best.y).toEqual([0.81, 0.85]);
  });

  // H-0062 Bugfix 2026-04-14: when retune seeds parent trials, the
  // x-axis should start from the parent's trial numbers — not 0 — so
  // the chart visually shows continuity instead of restarting.
  it("preserves parent trial numbers on the x-axis when seeded", () => {
    const trials = [
      trial(0, 0.81, 0.81),
      trial(1, 0.83, 0.83),
      trial(2, 0.83, 0.83),
      // retune adds a new trial that does NOT improve the parent best.
      trial(3, 0.79, 0.83),
    ];
    render(<LiveTrialChart trials={trials} />);
    const plot = readPlot();
    const score = plot.data.find((d) => d.name === "Score");
    const best = plot.data.find((d) => d.name === "Best");
    if (!score || !best) throw new Error("trace not found");
    expect(score.x).toEqual([0, 1, 2, 3]);
    expect(score.y).toEqual([0.81, 0.83, 0.83, 0.79]);
    // Best trace flat where the new trial is worse than parent best.
    expect(best.y).toEqual([0.81, 0.83, 0.83, 0.83]);
  });

  // The Best trace is not strictly monotonic — it follows
  // `best_score ?? score`. The chart simply renders what the bridge
  // sends; monotonicity is enforced backend-side by lizyml's
  // study.best_value, but the LiveTrialChart must not silently
  // recompute or lose the per-trial best.
  it("uses best_score from the trial when present, otherwise falls back to score", () => {
    const trials = [
      trial(0, 0.5, null), // no best yet
      trial(1, 0.7, 0.7),
    ];
    render(<LiveTrialChart trials={trials} />);
    const plot = readPlot();
    const best = plot.data.find((d) => d.name === "Best");
    if (!best) throw new Error("Best trace not found");
    // First entry falls back to score (0.5), second uses best_score (0.7).
    expect(best.y).toEqual([0.5, 0.7]);
  });

  it("renders the Optimization History header label", () => {
    render(
      <LiveTrialChart trials={[trial(0, 0.5, 0.5), trial(1, 0.6, 0.6)]} />,
    );
    expect(screen.getByText("Optimization History")).toBeInTheDocument();
  });
});
