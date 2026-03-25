import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TuneTab } from "./TuneTab";

const tuneConfig = {
  model: { name: "lgbm", params: {} },
  tuning: { optuna: { params: { n_trials: 50 }, space: {}, evaluation: {} } },
};

describe("TuneTab", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders Settings accordion section", () => {
    render(<TuneTab config={tuneConfig} onChange={vi.fn()} task="binary" />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders Search Space accordion section", () => {
    render(<TuneTab config={tuneConfig} onChange={vi.fn()} task="binary" />);
    expect(screen.getByText("Search Space")).toBeInTheDocument();
  });

  it("renders Evaluation accordion section", () => {
    render(<TuneTab config={tuneConfig} onChange={vi.fn()} task="binary" />);
    expect(screen.getByText("Evaluation")).toBeInTheDocument();
  });

  it("shows task-required message when task is null", () => {
    render(<TuneTab config={tuneConfig} onChange={vi.fn()} task={null} />);
    expect(
      screen.getByText("Select a task to configure evaluation metrics."),
    ).toBeInTheDocument();
  });
});
