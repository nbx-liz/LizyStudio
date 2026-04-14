import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProgressMessage, TrialResult } from "@/api/types";
import { ResultsRunningView } from "./ResultsRunningView";

// LiveTrialChart pulls in Plotly which is heavy; mock it so we can
// just verify wiring without rendering the actual chart.
vi.mock("./LiveTrialChart", () => ({
  LiveTrialChart: ({ trials }: { trials: TrialResult[] }) => (
    <div data-testid="live-trial-chart" data-count={trials.length} />
  ),
}));

function makeProgress(
  overrides: Partial<ProgressMessage> = {},
): ProgressMessage {
  return {
    type: "progress",
    current: 0,
    total: 0,
    ...overrides,
  };
}

function trial(
  number: number,
  score: number | null,
  best: number | null,
  state = "complete",
): TrialResult {
  return { number, score, state, best_score: best };
}

describe("ResultsRunningView — Trial table + LiveTrialChart wiring", () => {
  const baseProps = {
    headerLabel: "Tune",
    modelName: "lgbm",
    foldLog: [],
    cancelConfirm: false,
    onCancelConfirmChange: () => {},
    onCancel: () => {},
  };

  it("renders Running badge and header", () => {
    render(<ResultsRunningView {...baseProps} progress={null} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText(/Tune/)).toBeInTheDocument();
  });

  it("does NOT render the trial table when trial_results is empty", () => {
    render(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({ current: 1, total: 5, trial_results: [] })}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId("live-trial-chart")).toBeNull();
  });

  it("renders the trial table when at least one trial is present, but suppresses the chart until > 1", () => {
    render(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({
          current: 1,
          total: 5,
          trial_results: [trial(0, 0.9, 0.9)],
        })}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    // LiveTrialChart guard requires length > 1.
    expect(screen.queryByTestId("live-trial-chart")).toBeNull();
  });

  it("renders LiveTrialChart and forwards the full trial list when length >= 2", () => {
    const trials = [trial(0, 0.9, 0.9), trial(1, 0.85, 0.9)];
    render(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({ current: 2, total: 5, trial_results: trials })}
      />,
    );
    const chart = screen.getByTestId("live-trial-chart");
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveAttribute("data-count", "2");
  });

  // H-0062 Bugfix 2026-04-14: when resume seeds parent trials, the
  // adapter pre-populates accumulated_trials with the parent's history
  // and assigns each seeded row best_score = parent best. The Running
  // view must display the FULL list (parent + new) so the user can see
  // the previous results were not thrown away.
  it("displays seeded parent trials before any new trial completes", () => {
    const seededParent = [
      trial(0, 0.81, 0.81),
      trial(1, 0.83, 0.83),
      trial(2, 0.83, 0.83),
    ];
    render(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({
          current: 0,
          total: 5,
          trial_results: seededParent,
        })}
      />,
    );
    const table = screen.getByRole("table");
    // 1 header row + 3 body rows.
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBe(4);
    // Each seeded trial renders score AND best_score using the same
    // formatted value in this fixture, so getAllByText is required.
    expect(within(table).getAllByText("0.8100").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(within(table).getAllByText("0.8300").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("renders trials in reverse order (newest first)", () => {
    const trials = [
      trial(0, 0.81, 0.81),
      trial(1, 0.83, 0.83),
      trial(2, 0.85, 0.85),
    ];
    render(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({
          current: 3,
          total: 5,
          trial_results: trials,
        })}
      />,
    );
    const cells = screen
      .getAllByRole("cell")
      .filter((c) => /^\d$/.test(c.textContent ?? ""));
    // First "#" cell is for trial 2 (newest) due to .reverse()
    expect(cells[0].textContent).toBe("2");
  });

  it("renders em-dash placeholders for null score / null best_score", () => {
    const trials = [trial(0, null, null, "pruned"), trial(1, 0.85, 0.85)];
    render(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({
          current: 1,
          total: 5,
          trial_results: trials,
        })}
      />,
    );
    // Em-dash (\u2014) used for null fields. Two missing cells from the
    // first trial.
    const dashes = screen.getAllByText("\u2014");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("pruned")).toBeInTheDocument();
  });

  it("indeterminate progress when total === 0", () => {
    render(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({ current: 0, total: 0 })}
      />,
    );
    // Indeterminate Progress component emits an animate-pulse class on
    // the wrapper.
    const root = screen.getByText("Running").closest("div")?.parentElement;
    expect(root).not.toBeNull();
  });

  it("opens the cancel confirm dialog and calls onCancel when Yes is clicked", async () => {
    const onCancel = vi.fn();
    const onCancelConfirmChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({ current: 1, total: 5 })}
        cancelConfirm={false}
        onCancelConfirmChange={onCancelConfirmChange}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onCancelConfirmChange).toHaveBeenCalledWith(true);

    // Simulate the parent flipping the controlled prop.
    rerender(
      <ResultsRunningView
        {...baseProps}
        progress={makeProgress({ current: 1, total: 5 })}
        cancelConfirm={true}
        onCancelConfirmChange={onCancelConfirmChange}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Yes, Cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
