import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConvergenceSignalPanel } from "./ConvergenceSignalPanel";
import type { TuneRound } from "./types";

const roundConverged: TuneRound = {
  round: 3,
  n_trials: 20,
  best_score_before: 0.8701,
  best_score_after: 0.8702,
  expanded_dims: [],
};

const roundExpanding: TuneRound = {
  round: 2,
  n_trials: 20,
  best_score_before: 0.8,
  best_score_after: 0.85,
  expanded_dims: ["lr", "num_leaves"],
};

const roundNoExpansionButImproving: TuneRound = {
  round: 2,
  n_trials: 20,
  best_score_before: 0.8,
  best_score_after: 0.82,
  expanded_dims: [],
};

describe("ConvergenceSignalPanel", () => {
  it("renders converged banner with Apply button when expansion empty and improvement tiny", () => {
    const onApply = vi.fn();
    render(
      <ConvergenceSignalPanel
        rounds={[roundConverged]}
        onApplyToFit={onApply}
      />,
    );
    expect(screen.getByText(/search space converged/i)).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: /apply best params to fit/i,
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("disables Apply button when onApplyToFit missing", () => {
    render(<ConvergenceSignalPanel rounds={[roundConverged]} />);
    expect(
      screen.getByRole("button", { name: /apply best params to fit/i }),
    ).toBeDisabled();
  });

  it("renders active exploration banner when expansion is still happening", () => {
    render(<ConvergenceSignalPanel rounds={[roundExpanding]} />);
    expect(screen.getByText(/active exploration/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /apply best params to fit/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a stabilising banner when no expansion but improvement >= 0.001", () => {
    render(<ConvergenceSignalPanel rounds={[roundNoExpansionButImproving]} />);
    expect(screen.getByText(/stabilising/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/search space converged/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /apply best params to fit/i }),
    ).not.toBeInTheDocument();
  });

  it("renders a stabilising banner when no expansion but score regressed significantly", () => {
    // Uses Math.abs() so a regression of 0.1 is still >= 0.001 → not converged.
    const regressedRound: TuneRound = {
      round: 2,
      n_trials: 20,
      best_score_before: 0.9,
      best_score_after: 0.8,
      expanded_dims: [],
    };
    render(<ConvergenceSignalPanel rounds={[regressedRound]} />);
    expect(screen.getByText(/stabilising/i)).toBeInTheDocument();
  });

  it("uses last round for convergence decision", () => {
    render(
      <ConvergenceSignalPanel
        rounds={[roundExpanding, roundConverged]}
        onApplyToFit={vi.fn()}
      />,
    );
    // Last round is converged → converged banner wins
    expect(screen.getByText(/search space converged/i)).toBeInTheDocument();
    expect(screen.queryByText(/active exploration/i)).not.toBeInTheDocument();
  });

  it("treats null best_score_before as converged when expanded_dims empty", () => {
    const firstRound: TuneRound = {
      round: 1,
      n_trials: 50,
      best_score_before: null,
      best_score_after: 0.9,
      expanded_dims: [],
    };
    render(<ConvergenceSignalPanel rounds={[firstRound]} />);
    expect(screen.getByText(/search space converged/i)).toBeInTheDocument();
  });

  it("sets role=status on the banner container", () => {
    render(<ConvergenceSignalPanel rounds={[roundConverged]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
