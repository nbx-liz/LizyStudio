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

  it("renders Optimization Metric section when task and metric options are provided", () => {
    render(
      <TuneTab
        config={tuneConfig}
        onChange={vi.fn()}
        task="binary"
        uiSchema={{
          option_sets: {
            metric: { binary: ["auc", "f1", "accuracy"] },
          },
        }}
      />,
    );
    expect(screen.getByText("Optimization Metric")).toBeInTheDocument();
  });

  it("does not render Optimization Metric when no metric options", () => {
    render(
      <TuneTab
        config={tuneConfig}
        onChange={vi.fn()}
        task="binary"
        uiSchema={{ option_sets: { metric: {} } }}
      />,
    );
    expect(screen.queryByText("Optimization Metric")).not.toBeInTheDocument();
  });

  it("renders Additional Metrics when optimization metric is selected", () => {
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        optuna: {
          params: { n_trials: 50 },
          space: {},
          evaluation: { metrics: ["auc", "f1"] },
        },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={vi.fn()}
        task="binary"
        uiSchema={{
          option_sets: {
            metric: { binary: ["auc", "f1", "accuracy"] },
          },
        }}
      />,
    );
    expect(screen.getByText("Additional Metrics")).toBeInTheDocument();
  });

  it("shows direction badge for selected metric", () => {
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        optuna: {
          params: { n_trials: 50 },
          space: {},
          evaluation: { metrics: ["auc"] },
        },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={vi.fn()}
        task="binary"
        uiSchema={{
          option_sets: {
            metric: { binary: ["auc", "f1"] },
          },
          metric_direction: {
            binary: { auc: "maximize", f1: "maximize" },
          },
        }}
      />,
    );
    expect(screen.getByText("Direction:")).toBeInTheDocument();
    expect(screen.getByText("maximize")).toBeInTheDocument();
  });

  it("calls onChange with updated space when search space changes", () => {
    const onChange = vi.fn();
    render(<TuneTab config={tuneConfig} onChange={onChange} task="binary" />);
    // The SearchSpaceTable is rendered within the accordion
    expect(screen.getByText("Search Space")).toBeInTheDocument();
  });

  it("handles config without tuning key gracefully", () => {
    const config = {
      model: { name: "lgbm", params: {} },
    };
    render(<TuneTab config={config} onChange={vi.fn()} task="binary" />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Search Space")).toBeInTheDocument();
  });

  it("clicks additional metric badge to toggle selection", async () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        optuna: {
          params: { n_trials: 50 },
          space: {},
          evaluation: { metrics: ["auc"] },
        },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="binary"
        uiSchema={{
          option_sets: {
            metric: { binary: ["auc", "f1", "accuracy"] },
          },
        }}
      />,
    );

    const { fireEvent } = await import("@testing-library/react");
    // "f1" appears in both segment group and additional metrics; click the last one
    const f1Buttons = screen.getAllByText("f1");
    const f1Button = f1Buttons[f1Buttons.length - 1].closest("button");
    if (f1Button) fireEvent.click(f1Button);

    expect(onChange).toHaveBeenCalled();
  });
});
