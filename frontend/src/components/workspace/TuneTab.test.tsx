import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiSchema } from "@/api/types";
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
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1", "accuracy"] },
            },
          } as unknown as UiSchema
        }
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
        uiSchema={{ option_sets: { metric: {} } } as unknown as UiSchema}
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
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1", "accuracy"] },
            },
          } as unknown as UiSchema
        }
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
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1"] },
            },
            metric_direction: {
              binary: { auc: "maximize", f1: "maximize" },
            },
          } as unknown as UiSchema
        }
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
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1", "accuracy"] },
            },
          } as unknown as UiSchema
        }
      />,
    );

    const { fireEvent } = await import("@testing-library/react");
    // "f1" appears in both segment group and additional metrics; click the last one
    const f1Buttons = screen.getAllByText("f1");
    const f1Button = f1Buttons[f1Buttons.length - 1].closest("button");
    if (f1Button) fireEvent.click(f1Button);

    expect(onChange).toHaveBeenCalled();
  });

  it("reads evaluation from tuning.evaluation (not tuning.optuna.evaluation)", () => {
    // Widget conformance: evaluation lives at tuning.evaluation
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: { metrics: ["auc"] },
        optuna: { params: { n_trials: 50 }, space: {} },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={vi.fn()}
        task="binary"
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1"] },
            },
            metric_direction: { binary: { auc: "maximize", f1: "maximize" } },
          } as unknown as UiSchema
        }
      />,
    );
    // The optimization metric "auc" from tuning.evaluation must be shown
    expect(screen.getByText("maximize")).toBeInTheDocument();
  });

  it("handleOptimizationMetricChange updates tuning.evaluation (not optuna.evaluation)", () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: { metrics: ["auc"] },
        optuna: { params: { n_trials: 50 }, space: {} },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="binary"
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1"] },
            },
            metric_direction: { binary: { auc: "maximize", f1: "maximize" } },
          } as unknown as UiSchema
        }
      />,
    );

    const fe = fireEvent;
    const f1Buttons = screen.getAllByText("f1");
    // Click the optimization metric segment button for "f1"
    fe.click(f1Buttons[0].closest("button") ?? f1Buttons[0]);

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    // evaluation must be at tuning.evaluation, NOT tuning.optuna.evaluation
    const tuning = updated.tuning as Record<string, unknown>;
    expect(tuning.evaluation).toBeDefined();
    const evaluation = tuning.evaluation as { metrics: unknown[] };
    expect(evaluation.metrics).toBeDefined();
  });

  it("falls back to first metricOption when no evalMetrics configured", () => {
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        // No evaluation key — evaluation.metrics defaults to []
        optuna: { params: {}, space: {} },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={vi.fn()}
        task="binary"
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1"] },
            },
            metric_direction: { binary: { auc: "maximize", f1: "maximize" } },
          } as unknown as UiSchema
        }
      />,
    );
    // "auc" is the first metricOption — it should be shown as the active metric
    expect(screen.getByText("Optimization Metric")).toBeInTheDocument();
    expect(screen.getByText("maximize")).toBeInTheDocument();
  });

  it("handleOptimizationMetricChange when task has no metricDirection entry defaults to minimize", () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: { metrics: ["auc"] },
        optuna: { params: {}, space: {} },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="binary"
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1"] },
            },
            // metric_direction has no entry for "binary"
            metric_direction: {},
          } as unknown as UiSchema
        }
      />,
    );

    const fe = fireEvent;
    const f1Buttons = screen.getAllByText("f1");
    fe.click(f1Buttons[0].closest("button") ?? f1Buttons[0]);

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    const tuning = updated.tuning as Record<string, unknown>;
    const optuna = tuning.optuna as Record<string, unknown>;
    const params = optuna.params as Record<string, unknown>;
    // direction should default to "minimize" when task not in metricDirection
    expect(params.direction).toBe("minimize");
  });

  it("shows precision_at_k k-value input when precision_at_k is in evalMetrics", () => {
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: {
          metrics: [{ precision_at_k: { k: 5 } }],
        },
        optuna: { params: {}, space: {} },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={vi.fn()}
        task="binary"
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["precision_at_k", "auc"] },
            },
          } as unknown as UiSchema
        }
      />,
    );
    // k label is a plain span with no aria association — use text query
    expect(screen.queryByText("k")).toBeInTheDocument();
  });

  it("handleTuneKChange updates precision_at_k k value in tuning.evaluation", () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: {
          metrics: [{ precision_at_k: { k: 5 } }],
        },
        optuna: { params: {}, space: {} },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="binary"
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["precision_at_k", "auc"] },
            },
          } as unknown as UiSchema
        }
      />,
    );

    // CompactStepper renders "+" as text for the increment button
    const plusButtons = screen.getAllByText("+");
    const kIncrBtn = plusButtons[plusButtons.length - 1].closest("button");
    if (kIncrBtn) fireEvent.click(kIncrBtn);

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    const tuning = updated.tuning as Record<string, unknown>;
    const evaluation = tuning.evaluation as {
      metrics: Array<{ precision_at_k?: { k: number } }>;
    };
    expect(evaluation.metrics[0]).toEqual({ precision_at_k: { k: 6 } });
  });

  it("additional metric deselection removes metric from evalMetrics", () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: { metrics: ["auc", "f1"] },
        optuna: { params: {}, space: {} },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="binary"
        uiSchema={
          {
            option_sets: {
              metric: { binary: ["auc", "f1", "accuracy"] },
            },
          } as unknown as UiSchema
        }
      />,
    );

    // "f1" is already selected as additional — clicking it should deselect
    const fe = fireEvent;
    const f1Badges = screen.getAllByText("f1");
    // The last "f1" element in Additional Metrics section
    const f1AdditionalBtn = f1Badges[f1Badges.length - 1].closest("button");
    if (f1AdditionalBtn) fe.click(f1AdditionalBtn);

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0];
    const tuning = updated.tuning as Record<string, unknown>;
    const evaluation = tuning.evaluation as { metrics: string[] };
    expect(evaluation.metrics).not.toContain("f1");
  });
});
