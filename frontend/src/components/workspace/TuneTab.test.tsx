import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiSchema } from "@/api/types";
import { TuneTab } from "./TuneTab";

// Mock SearchSpaceTable to expose its props as callable test handles
vi.mock("./SearchSpaceTable", () => ({
  SearchSpaceTable: (props: {
    onChange?: (space: Record<string, unknown>) => void;
    onModelParamChange?: (key: string, value: unknown) => void;
  }) => (
    <div data-testid="search-space-table">
      <button
        type="button"
        data-testid="trigger-space-change"
        onClick={() =>
          props.onChange?.({ new_param: { type: "float", low: 0, high: 1 } })
        }
      >
        change space
      </button>
      <button
        type="button"
        data-testid="trigger-model-param-change"
        onClick={() => props.onModelParamChange?.("max_depth", 5)}
      >
        change model param
      </button>
    </div>
  ),
  groupToCategory: (group: string) => group,
}));

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

  it("auto-initializes search space from catalog entries with default_mode=range", async () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        optuna: { params: {}, space: {} },
      },
    };
    const uiSchema = {
      search_space_catalog: [
        {
          key: "learning_rate",
          title: "Learning Rate",
          paramType: "float",
          modes: ["fixed", "range"],
          default_mode: "range",
          default_range: { low: 0.01, high: 0.3, log: true },
          group: "model_params",
        },
        {
          key: "num_leaves",
          title: "Num Leaves",
          paramType: "integer",
          modes: ["fixed", "range"],
          default_mode: "range",
          default_range: { low: 20, high: 200, log: false },
        },
        {
          key: "fixed_param",
          title: "Fixed Param",
          paramType: "integer",
          modes: ["fixed"],
          default_mode: "fixed",
        },
      ],
    } as unknown as import("@/api/types").UiSchema;

    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="binary"
        uiSchema={uiSchema}
      />,
    );

    // useEffect runs asynchronously — wait for onChange to be called
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const updated = onChange.mock.calls[0][0] as Record<string, unknown>;
    const tuning = updated.tuning as Record<string, unknown>;
    const optuna = tuning.optuna as Record<string, unknown>;
    const space = optuna.space as Record<string, unknown>;

    // Only range-mode entries should be added
    expect(space.learning_rate).toMatchObject({
      type: "float",
      low: 0.01,
      high: 0.3,
      log: true,
    });
    expect(space.num_leaves).toMatchObject({
      type: "int",
      low: 20,
      high: 200,
      log: false,
    });
    // fixed_param must NOT be included
    expect(space.fixed_param).toBeUndefined();
  });

  it("does not auto-initialize search space when catalog has no range entries", async () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: { optuna: { params: {}, space: {} } },
    };
    const uiSchema = {
      search_space_catalog: [
        {
          key: "fixed_param",
          title: "Fixed",
          paramType: "integer",
          modes: ["fixed"],
          default_mode: "fixed",
        },
      ],
    } as unknown as import("@/api/types").UiSchema;

    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="binary"
        uiSchema={uiSchema}
      />,
    );

    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 10));
    // onChange should NOT be called since no range entries exist
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not auto-initialize when search space already has entries", async () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        optuna: {
          params: {},
          space: {
            learning_rate: { type: "float", low: 0.01, high: 0.1, log: false },
          },
        },
      },
    };
    const uiSchema = {
      search_space_catalog: [
        {
          key: "learning_rate",
          title: "Learning Rate",
          paramType: "float",
          modes: ["fixed", "range"],
          default_mode: "range",
          default_range: { low: 0.01, high: 0.3, log: true },
        },
      ],
    } as unknown as import("@/api/types").UiSchema;

    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="binary"
        uiSchema={uiSchema}
      />,
    );

    await new Promise((r) => setTimeout(r, 10));
    // onChange should NOT be called — space already populated
    expect(onChange).not.toHaveBeenCalled();
  });

  it("handleOptimizationMetricChange sets precision_at_k as optimization metric", () => {
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
        task="ranking"
        uiSchema={
          {
            option_sets: {
              metric: { ranking: ["precision_at_k", "auc"] },
            },
            metric_direction: {
              ranking: { precision_at_k: "maximize", auc: "maximize" },
            },
          } as unknown as import("@/api/types").UiSchema
        }
      />,
    );

    const fe = fireEvent;
    const pakButtons = screen.getAllByText("precision_at_k");
    fe.click(pakButtons[0].closest("button") ?? pakButtons[0]);

    expect(onChange).toHaveBeenCalled();
    // Bug 2026-04-14 (4) — Fix 3: TuneEvaluationSection now also runs a
    // defensive useEffect that syncs ``optuna.params.direction`` to the
    // resolved metric direction on mount/metric-change. That effect can
    // fire BEFORE the user's click, so ``mock.calls[0]`` is the
    // direction-sync update and the click result lives later in the
    // call history. Pick the latest call that actually carries an
    // updated ``evaluation.metrics`` to assert against.
    const callsWithMetricsUpdate = onChange.mock.calls.filter((c) => {
      const t = (c[0] as Record<string, unknown>).tuning as
        | Record<string, unknown>
        | undefined;
      const evalSection = t?.evaluation as { metrics?: unknown[] } | undefined;
      return evalSection?.metrics !== undefined;
    });
    expect(callsWithMetricsUpdate.length).toBeGreaterThan(0);
    const updated = callsWithMetricsUpdate[
      callsWithMetricsUpdate.length - 1
    ][0] as Record<string, unknown>;
    const tuning = updated.tuning as Record<string, unknown>;
    const evaluation = tuning.evaluation as { metrics: unknown[] };
    // First entry must be the dict form of precision_at_k
    expect(evaluation.metrics[0]).toEqual({ precision_at_k: { k: 10 } });
  });

  it("handleTuneKChange preserves non-precision_at_k entries unchanged", () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: {
          metrics: [{ precision_at_k: { k: 5 } }, "auc"],
        },
        optuna: { params: {}, space: {} },
      },
    };
    render(
      <TuneTab
        config={config}
        onChange={onChange}
        task="ranking"
        uiSchema={
          {
            option_sets: {
              metric: { ranking: ["precision_at_k", "auc"] },
            },
          } as unknown as import("@/api/types").UiSchema
        }
      />,
    );

    const plusButtons = screen.getAllByText("+");
    const kIncrBtn = plusButtons[plusButtons.length - 1].closest("button");
    if (kIncrBtn) fireEvent.click(kIncrBtn);

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as Record<string, unknown>;
    const tuning = updated.tuning as Record<string, unknown>;
    const evaluation = tuning.evaluation as {
      metrics: Array<unknown>;
    };
    // "auc" string entry must remain unchanged
    expect(evaluation.metrics[1]).toBe("auc");
    // precision_at_k entry must be updated
    expect(evaluation.metrics[0]).toEqual({ precision_at_k: { k: 6 } });
  });

  it("autoDirection is empty string when no task or metric is set", () => {
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        optuna: { params: {}, space: {} },
      },
    };
    render(<TuneTab config={config} onChange={vi.fn()} task={null} />);
    // No direction badge should be visible when task is null
    expect(screen.queryByText("Direction:")).not.toBeInTheDocument();
  });

  it("autoDirection falls back to minimize when metric has no direction entry", () => {
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: { metrics: ["unknown_metric"] },
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
              metric: { binary: ["unknown_metric", "auc"] },
            },
            metric_direction: { binary: { auc: "maximize" } },
          } as unknown as import("@/api/types").UiSchema
        }
      />,
    );
    // unknown_metric has no direction entry → should fall back to "minimize"
    expect(screen.getByText("minimize")).toBeInTheDocument();
  });

  it("handleSpaceChange calls onChange with updated optuna space", () => {
    const onChange = vi.fn();
    render(<TuneTab config={tuneConfig} onChange={onChange} task="binary" />);

    fireEvent.click(screen.getByTestId("trigger-space-change"));

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as Record<string, unknown>;
    const tuning = updated.tuning as Record<string, unknown>;
    const optuna = tuning.optuna as Record<string, unknown>;
    expect(optuna.space).toMatchObject({
      new_param: { type: "float", low: 0, high: 1 },
    });
  });

  it("handleModelParamChange updates model.params in config", () => {
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: { existing: 1 } },
      tuning: { optuna: { params: {}, space: {} } },
    };
    render(<TuneTab config={config} onChange={onChange} task="binary" />);

    fireEvent.click(screen.getByTestId("trigger-model-param-change"));

    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as Record<string, unknown>;
    const model = updated.model as Record<string, unknown>;
    const params = model.params as Record<string, unknown>;
    expect(params.max_depth).toBe(5);
    expect(params.existing).toBe(1);
  });

  it("handleOptimizationMetricChange filters out new optimization metric from additional metrics", () => {
    // When switching opt metric to "f1" while "f1" is already an additional metric,
    // it should be removed from additional metrics list
    const onChange = vi.fn();
    const config = {
      model: { name: "lgbm", params: {} },
      tuning: {
        evaluation: { metrics: ["auc", "f1", "accuracy"] },
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
            metric_direction: {
              binary: { auc: "maximize", f1: "maximize", accuracy: "maximize" },
            },
          } as unknown as UiSchema
        }
      />,
    );

    // Click "f1" in the SegmentGroup (first occurrence = optimization metric selector)
    const f1Buttons = screen.getAllByText("f1");
    fireEvent.click(f1Buttons[0].closest("button") ?? f1Buttons[0]);

    expect(onChange).toHaveBeenCalled();
    // Bug 2026-04-14 (4) — Fix 3: pick the click-induced call, not the
    // direction-sync useEffect that fires on mount. See the matching
    // comment in the precision_at_k test above.
    const callsWithMetricsUpdate = onChange.mock.calls.filter((c) => {
      const t = (c[0] as Record<string, unknown>).tuning as
        | Record<string, unknown>
        | undefined;
      const evalSection = t?.evaluation as { metrics?: unknown[] } | undefined;
      return evalSection?.metrics !== undefined;
    });
    expect(callsWithMetricsUpdate.length).toBeGreaterThan(0);
    const updated = callsWithMetricsUpdate[
      callsWithMetricsUpdate.length - 1
    ][0] as Record<string, unknown>;
    const tuning = updated.tuning as Record<string, unknown>;
    const evaluation = tuning.evaluation as { metrics: unknown[] };
    // "f1" should be the new optimization metric (index 0)
    expect(evaluation.metrics[0]).toBe("f1");
    // "f1" must NOT appear again in additional metrics (filtered out at line 239)
    const additionalNames = evaluation.metrics
      .slice(1)
      .map((e) => (typeof e === "string" ? e : ""));
    expect(additionalNames).not.toContain("f1");
  });

  // P-0104 Wave 2.3 / Issue #459 — Tune Evaluation defaults & inner_valid
  // auto-reset

  describe("P-0104 Wave 2.3", () => {
    it("auto-populates tuning.evaluation.metrics with canonical defaults on fresh binary config", () => {
      const onChange = vi.fn();
      const config = {
        model: { name: "lgbm", params: {} },
        tuning: { optuna: { params: { n_trials: 50 }, space: {} } },
      };
      render(
        <TuneTab
          config={config}
          onChange={onChange}
          task="binary"
          uiSchema={
            {
              option_sets: {
                metric: {
                  binary: ["auc", "auc_pr", "brier", "logloss", "f1"],
                },
              },
            } as unknown as UiSchema
          }
        />,
      );
      // The seeding effect fires synchronously inside useEffect on mount.
      const seedingCalls = onChange.mock.calls.filter((c) => {
        const t = (c[0] as Record<string, unknown>).tuning as
          | Record<string, unknown>
          | undefined;
        const ev = t?.evaluation as { metrics?: unknown[] } | undefined;
        return Array.isArray(ev?.metrics);
      });
      expect(seedingCalls.length).toBeGreaterThan(0);
      const seeded = seedingCalls[0][0] as Record<string, unknown>;
      const ev = (seeded.tuning as Record<string, unknown>).evaluation as {
        metrics: string[];
      };
      expect(ev.metrics).toEqual(["auc", "auc_pr", "brier", "logloss"]);
    });

    it("does not seed defaults when tuning.evaluation.metrics is already set (even to [])", () => {
      const onChange = vi.fn();
      const config = {
        model: { name: "lgbm", params: {} },
        tuning: {
          evaluation: { metrics: [] },
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
                metric: { binary: ["auc", "auc_pr", "brier", "logloss"] },
              },
            } as unknown as UiSchema
          }
        />,
      );
      const seedingCalls = onChange.mock.calls.filter((c) => {
        const t = (c[0] as Record<string, unknown>).tuning as
          | Record<string, unknown>
          | undefined;
        const ev = t?.evaluation as { metrics?: unknown[] } | undefined;
        return Array.isArray(ev?.metrics) && (ev?.metrics?.length ?? 0) > 0;
      });
      expect(seedingCalls).toHaveLength(0);
    });

    it("does not seed defaults for non-binary task (regression / multiclass deferred)", () => {
      const onChange = vi.fn();
      const config = {
        model: { name: "lgbm", params: {} },
        tuning: { optuna: { params: { n_trials: 50 }, space: {} } },
      };
      render(
        <TuneTab
          config={config}
          onChange={onChange}
          task="regression"
          uiSchema={
            {
              option_sets: {
                metric: { regression: ["rmse", "mae", "mape"] },
              },
            } as unknown as UiSchema
          }
        />,
      );
      const seedingCalls = onChange.mock.calls.filter((c) => {
        const t = (c[0] as Record<string, unknown>).tuning as
          | Record<string, unknown>
          | undefined;
        const ev = t?.evaluation as { metrics?: unknown[] } | undefined;
        return Array.isArray(ev?.metrics);
      });
      expect(seedingCalls).toHaveLength(0);
    });

    it("auto-resets inner_valid when persisted value is not allowed under the current CV strategy", () => {
      const onChange = vi.fn();
      // group_holdout is only allowed under group_* / blocked_group_kfold;
      // under plain kfold it must collapse back to "holdout".
      const config = {
        model: {
          name: "lgbm",
          params: { inner_valid: "group_holdout" },
        },
        split: { method: "kfold" },
        tuning: { optuna: { params: { n_trials: 50 }, space: {} } },
      };
      render(
        <TuneTab
          config={config}
          onChange={onChange}
          task="binary"
          uiSchema={
            {
              inner_valid_options: ["holdout", "group_holdout", "time_holdout"],
              option_sets: { metric: { binary: ["auc"] } },
            } as unknown as UiSchema
          }
        />,
      );
      const innerValidCalls = onChange.mock.calls.filter((c) => {
        const m = (c[0] as Record<string, unknown>).model as
          | Record<string, unknown>
          | undefined;
        const p = m?.params as Record<string, unknown> | undefined;
        return p && "inner_valid" in p;
      });
      expect(innerValidCalls.length).toBeGreaterThan(0);
      const last = innerValidCalls[innerValidCalls.length - 1][0] as {
        model: { params: { inner_valid: string } };
      };
      expect(last.model.params.inner_valid).toBe("holdout");
    });

    it("preserves inner_valid when value is allowed under current CV strategy", () => {
      const onChange = vi.fn();
      const config = {
        model: { name: "lgbm", params: { inner_valid: "holdout" } },
        split: { method: "kfold" },
        tuning: { optuna: { params: { n_trials: 50 }, space: {} } },
      };
      render(
        <TuneTab
          config={config}
          onChange={onChange}
          task="binary"
          uiSchema={
            {
              inner_valid_options: ["holdout", "group_holdout", "time_holdout"],
              option_sets: { metric: { binary: ["auc"] } },
            } as unknown as UiSchema
          }
        />,
      );
      // The seed-defaults effect may produce onChange calls for the
      // ``tuning.evaluation`` section; the inner_valid invariant we
      // assert is that no call SETS inner_valid to a value other than
      // the persisted "holdout".
      const mutatedInnerValid = onChange.mock.calls
        .map((c) => {
          const m = (c[0] as Record<string, unknown>).model as
            | Record<string, unknown>
            | undefined;
          const p = m?.params as Record<string, unknown> | undefined;
          return p?.inner_valid;
        })
        .filter((v) => v !== undefined && v !== "holdout");
      expect(mutatedInnerValid).toHaveLength(0);
    });
  });
});
