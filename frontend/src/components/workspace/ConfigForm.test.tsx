import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiSchema } from "@/api/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigForm } from "./ConfigForm";

// Mock DynParam which needs TooltipProvider.
// Captures props so tests can inspect hint/value/options passed to each instance.
const dynParamCalls: {
  hint: { key: string; kind: string };
  value: unknown;
  options: string[];
  visible: boolean;
}[] = [];

vi.mock("./DynParam", () => ({
  DynParam: (props: {
    hint: { key: string; kind: string };
    value: unknown;
    options: string[];
    visible: boolean;
    onChange: (v: unknown) => void;
  }) => {
    dynParamCalls.push({
      hint: props.hint,
      value: props.value,
      options: props.options,
      visible: props.visible,
    });
    return (
      <button
        type="button"
        data-testid="dyn-param"
        data-hint-key={props.hint.key}
        data-value={String(props.value)}
        data-visible={String(props.visible)}
        onClick={() => props.onChange("__changed__")}
      />
    );
  },
}));

function renderConfigForm(props: Parameters<typeof ConfigForm>[0]) {
  return render(
    <TooltipProvider>
      <ConfigForm {...props} />
    </TooltipProvider>,
  );
}

const minimalSchema = {
  properties: {
    model: {
      type: "object",
      title: "Model",
      properties: {
        name: { type: "string", const: "lgbm" },
        params: { type: "object", additionalProperties: true },
      },
    },
  },
  $defs: {},
};

const minimalConfig = {
  model: { name: "lgbm", params: {} },
};

const multiSectionSchema = {
  properties: {
    model: {
      type: "object",
      title: "Model",
      properties: {
        name: { type: "string", const: "lgbm" },
        params: { type: "object", additionalProperties: true },
      },
    },
    training: {
      type: "object",
      title: "Training",
      properties: {
        n_iterations: { type: "integer", title: "Iterations", default: 100 },
      },
    },
    config_version: { type: "string", title: "Config Version" },
    tuning: {
      type: "object",
      title: "Tuning",
      properties: { optuna: { type: "object" } },
    },
    data: {
      type: "object",
      title: "Data",
      properties: { path: { type: "string" } },
    },
    features: { type: "object", title: "Features", properties: {} },
    split: { type: "object", title: "Split", properties: {} },
    task: { type: "string", title: "Task" },
    output_dir: { type: "string", title: "Output Dir" },
  },
  $defs: {},
};

const multiSectionConfig = {
  model: { name: "lgbm", params: {} },
  training: { n_iterations: 100 },
  config_version: "1.0",
  tuning: { optuna: {} },
  data: { path: "/data" },
  features: {},
  split: {},
  task: "binary",
  output_dir: "/output",
};

describe("ConfigForm", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("returns null when schema has no properties", () => {
    const { container } = renderConfigForm({
      schema: { $defs: {} },
      config: {},
      onChange: vi.fn(),
    });
    // ConfigForm returns null when no rawProperties → TooltipProvider wraps empty
    expect(container.textContent).toBe("");
  });

  it("renders accordion sections for object properties", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
    });
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("hidden fields (config_version, tuning) are not shown", () => {
    renderConfigForm({
      schema: multiSectionSchema,
      config: multiSectionConfig,
      onChange: vi.fn(),
    });
    expect(screen.queryByText("Config Version")).toBeNull();
    expect(screen.queryByText("Tuning")).toBeNull();
  });

  it("DATA_PANEL_FIELDS are not shown", () => {
    renderConfigForm({
      schema: multiSectionSchema,
      config: multiSectionConfig,
      onChange: vi.fn(),
    });
    expect(screen.queryByText("Output Dir")).toBeNull();
  });

  it("renders Evaluation section when task is provided", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: "binary",
    });
    expect(screen.getByText("Evaluation")).toBeInTheDocument();
  });

  it("does not render Evaluation section when task is null", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: null,
    });
    expect(screen.queryByText("Evaluation")).toBeNull();
  });

  it("renders Training section heading", () => {
    renderConfigForm({
      schema: multiSectionSchema,
      config: multiSectionConfig,
      onChange: vi.fn(),
    });
    expect(screen.getByText("Training")).toBeInTheDocument();
  });

  it("renders Model section with Smart Params and Additional Params labels", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
    });
    expect(screen.getByText("Smart Params")).toBeInTheDocument();
    expect(screen.getByText("Model Params")).toBeInTheDocument();
    expect(screen.getByText("Additional Params")).toBeInTheDocument();
  });

  it("renders inner_valid ratio when early_stopping is enabled", () => {
    const schema = {
      properties: {
        model: {
          type: "object",
          title: "Model",
          properties: {
            name: { type: "string", const: "lgbm" },
            params: { type: "object", additionalProperties: true },
          },
        },
        training: {
          type: "object",
          title: "Training",
          properties: {
            early_stopping: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
                patience: { type: "integer", default: 10 },
              },
            },
          },
        },
      },
      $defs: {},
    };
    const config = {
      model: { name: "lgbm", params: {} },
      training: {
        early_stopping: {
          enabled: true,
          patience: 10,
          inner_valid: { method: "holdout", ratio: 0.15 },
        },
      },
    };

    renderConfigForm({
      schema,
      config,
      onChange: vi.fn(),
    });

    expect(screen.getByText("Inner Valid Ratio")).toBeInTheDocument();
  });

  it("does not render inner_valid ratio when early_stopping is disabled", () => {
    const schema = {
      properties: {
        model: {
          type: "object",
          title: "Model",
          properties: {
            name: { type: "string", const: "lgbm" },
            params: { type: "object", additionalProperties: true },
          },
        },
        training: {
          type: "object",
          title: "Training",
          properties: {
            early_stopping: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: false },
              },
            },
          },
        },
      },
      $defs: {},
    };
    const config = {
      model: { name: "lgbm", params: {} },
      training: {
        early_stopping: { enabled: false },
      },
    };

    renderConfigForm({
      schema,
      config,
      onChange: vi.fn(),
    });

    expect(screen.queryByText("Inner Valid Ratio")).not.toBeInTheDocument();
  });

  it("renders calibration section for binary task by default", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "binary",
    });

    expect(screen.getByText("Calibration")).toBeInTheDocument();
  });

  it("does not render calibration section for regression task", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "regression",
    });

    expect(screen.queryByText("Calibration")).not.toBeInTheDocument();
  });

  it("auto-clears stale calibration when task is not binary (Issue #269)", async () => {
    // Reproduces the silent state bug from #269: calibration was set
    // while task=binary, then the user switched to regression and the
    // Calibration UI hid itself but the value lingered, causing a
    // ~5s LightGBM error after Fit. The auto-reset effect must
    // immediately write calibration=null on render with task!=binary.
    const onChange = vi.fn();
    const staleConfig = {
      ...minimalConfig,
      config_version: 1,
      calibration: { method: "platt", n_splits: 5, params: {} },
    };
    renderConfigForm({
      schema: minimalSchema,
      config: staleConfig,
      onChange,
      task: "regression",
    });

    // Allow the effect to flush.
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    // The reset write must zero the calibration field (immutably).
    const calls = onChange.mock.calls.map((c) => c[0]);
    const cleared = calls.find(
      (c) => c && (c as { calibration?: unknown }).calibration === null,
    );
    expect(cleared).toBeTruthy();
  });

  it("does not auto-clear calibration on binary task", async () => {
    const onChange = vi.fn();
    const config = {
      ...minimalConfig,
      config_version: 1,
      calibration: { method: "platt", n_splits: 5, params: {} },
    };
    renderConfigForm({
      schema: minimalSchema,
      config,
      onChange,
      task: "binary",
    });

    // Brief wait — binary must NOT trigger the reset effect.
    await new Promise((r) => setTimeout(r, 50));
    const reset = onChange.mock.calls.find(
      (c) => c[0] && (c[0] as { calibration?: unknown }).calibration === null,
    );
    expect(reset).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Issue #272 — task-derived effects must wait for config.task to catch up
  // -------------------------------------------------------------------------
  it("skips task-derived effects while config.task is stale (Issue #272)", async () => {
    // Race scenario: the user just clicked task=regression. WorkspacePage's
    // task prop is regression (synchronous setter), but the cached config
    // returned by useConfig() still has task=binary because useConfigSync
    // has not finished its PUT yet. ConfigForm's auto-select / auto-clear
    // effects must NOT fire on this stale snapshot — otherwise they PUT
    // a binary-task body and revert the user's regression change.
    const onChange = vi.fn();
    const staleConfig = {
      config_version: 1,
      task: "binary",
      model: {
        name: "lgbm",
        // Stale binary objective + calibration; both would normally
        // trigger reset effects.
        params: { objective: "binary", metric: ["auc"] },
      },
      calibration: { method: "platt", n_splits: 5, params: {} },
    };
    renderConfigForm({
      schema: minimalSchema,
      config: staleConfig,
      onChange,
      // Prop says regression — fresh from the radio click.
      task: "regression",
      uiSchema: {
        parameter_hints: [],
        option_sets: {
          objective: {
            binary: ["binary", "cross_entropy"],
            regression: ["huber", "regression_l1"],
          },
          model_metric: {
            binary: ["auc", "binary_logloss"],
            regression: ["rmse", "huber"],
          },
        },
      } as unknown as UiSchema,
    });

    // Allow effect microtasks to flush.
    await new Promise((r) => setTimeout(r, 60));

    // Critical guard: NONE of the task-derived effects (objective auto-
    // select, metric auto-select, calibration auto-clear) may fire while
    // the snapshot's task differs from the prop task. Each of those
    // writes would otherwise PUT a body where ``task`` is still
    // ``binary`` (because configRef.current.task is binary), reverting
    // the user's regression intent.
    const wroteObjective = onChange.mock.calls.find(
      ([cfg]) =>
        cfg?.model?.params?.objective !== undefined &&
        cfg.model.params.objective !== "binary",
    );
    expect(wroteObjective).toBeUndefined();

    const wroteMetric = onChange.mock.calls.find(
      ([cfg]) =>
        cfg?.model?.params?.metric !== undefined &&
        JSON.stringify(cfg.model.params.metric) !== JSON.stringify(["auc"]),
    );
    expect(wroteMetric).toBeUndefined();

    const clearedCalibration = onChange.mock.calls.find(
      ([cfg]) => cfg?.calibration === null,
    );
    expect(clearedCalibration).toBeUndefined();
  });

  it("runs task-derived effects once config.task catches up (Issue #272)", async () => {
    // Inverse case: once ``useConfigSync`` has flushed and the cached
    // config now reflects ``task=regression``, the task-derived effects
    // are free to fire. (configRef.current.task === task prop)
    const onChange = vi.fn();
    const freshConfig = {
      config_version: 1,
      task: "regression",
      model: {
        name: "lgbm",
        // Stale binary objective from before the task change — should
        // be reset because task is now regression and the snapshot agrees.
        params: { objective: "binary" },
      },
      calibration: { method: "platt", n_splits: 5, params: {} },
    };
    renderConfigForm({
      schema: minimalSchema,
      config: freshConfig,
      onChange,
      task: "regression",
      uiSchema: {
        parameter_hints: [],
        option_sets: {
          objective: {
            binary: ["binary", "cross_entropy"],
            regression: ["huber", "regression_l1"],
          },
          model_metric: {
            binary: ["auc", "binary_logloss"],
            regression: ["rmse", "huber"],
          },
        },
      } as unknown as UiSchema,
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    // Calibration must clear (regression doesn't support it).
    const clearedCalibration = onChange.mock.calls.find(
      ([cfg]) => cfg?.calibration === null,
    );
    expect(clearedCalibration).toBeTruthy();

    // Objective must reset to a regression-valid value.
    const resetObjective = onChange.mock.calls.find(
      ([cfg]) =>
        cfg?.model?.params?.objective === "huber" ||
        cfg?.model?.params?.objective === "regression_l1",
    );
    expect(resetObjective).toBeTruthy();
  });

  it("renders section title from uiSchema when provided", () => {
    renderConfigForm({
      schema: multiSectionSchema,
      config: multiSectionConfig,
      onChange: vi.fn(),
      uiSchema: {
        sections: [{ key: "training", title: "Training Settings" }],
      } as unknown as UiSchema,
    });
    expect(screen.getByText("Training Settings")).toBeInTheDocument();
  });

  it("renders calibration section based on conditional_visibility", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "multiclass",
      uiSchema: {
        conditional_visibility: {
          calibration: { task: ["binary", "multiclass"] },
        },
      } as unknown as UiSchema,
    });

    expect(screen.getByText("Calibration")).toBeInTheDocument();
  });

  it("hides calibration section based on conditional_visibility when task not included", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "regression",
      uiSchema: {
        conditional_visibility: {
          calibration: { task: ["binary", "multiclass"] },
        },
      } as unknown as UiSchema,
    });

    expect(screen.queryByText("Calibration")).not.toBeInTheDocument();
  });

  it("renders DynParam components when parameter_hints are provided", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "objective", kind: "objective", label: "Objective" },
        ],
      } as unknown as UiSchema,
    });

    expect(screen.getByTestId("dyn-param")).toBeInTheDocument();
  });

  describe("Progressive Disclosure (Essential / Advanced split)", () => {
    const uiSchemaWithHints = {
      parameter_hints: [
        { key: "objective", kind: "objective", label: "Objective" },
        { key: "learning_rate", kind: "number", label: "LR" },
        { key: "n_estimators", kind: "integer", label: "N Est" },
        { key: "max_depth", kind: "integer", label: "Depth" },
        // Advanced params:
        { key: "feature_fraction", kind: "number", label: "FF" },
        { key: "lambda_l1", kind: "number", label: "L1" },
        { key: "verbose", kind: "integer", label: "Verbose" },
      ],
    } as unknown as UiSchema;

    it("shows 'Show advanced' toggle when advanced params exist", () => {
      renderConfigForm({
        schema: minimalSchema,
        config: minimalConfig,
        onChange: vi.fn(),
        uiSchema: uiSchemaWithHints,
      });

      const toggle = screen.getByTestId("toggle-advanced-params");
      expect(toggle).toBeInTheDocument();
      expect(toggle.textContent).toContain("Show advanced");
      expect(toggle.textContent).toContain("3");
    });

    it("hides advanced DynParam by default, shows on click", () => {
      renderConfigForm({
        schema: minimalSchema,
        config: minimalConfig,
        onChange: vi.fn(),
        uiSchema: uiSchemaWithHints,
      });

      // Only essential params rendered initially (4 essential)
      const initialParams = screen.getAllByTestId("dyn-param");
      expect(initialParams.length).toBe(4);

      // Click toggle
      fireEvent.click(screen.getByTestId("toggle-advanced-params"));

      // All params rendered (4 essential + 3 advanced = 7)
      const allParams = screen.getAllByTestId("dyn-param");
      expect(allParams.length).toBe(7);
    });

    it("does not show toggle when all params are essential", () => {
      renderConfigForm({
        schema: minimalSchema,
        config: minimalConfig,
        onChange: vi.fn(),
        uiSchema: {
          parameter_hints: [
            { key: "objective", kind: "objective", label: "Obj" },
            { key: "learning_rate", kind: "number", label: "LR" },
          ],
        } as unknown as UiSchema,
      });

      expect(
        screen.queryByTestId("toggle-advanced-params"),
      ).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: shouldShowField, getOptionsForHint, getValueForHint,
// handleHintChange, auto-select useEffect, MetricsChips integration,
// inner_valid_options, Calibration edge cases
// ---------------------------------------------------------------------------

describe("ConfigForm — shouldShowField conditional_visibility", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  // Use essential key "num_leaves" so DynParam is always rendered (not gated by showAdvanced)

  it("passes visible=true when conditional_visibility condition is satisfied from modelConfig", () => {
    // num_leaves visible only when boosting_type === "goss" — and boosting_type lives in model config
    renderConfigForm({
      schema: minimalSchema,
      config: { model: { name: "lgbm", boosting_type: "goss", params: {} } },
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "num_leaves", kind: "integer", label: "Num Leaves" },
        ],
        conditional_visibility: {
          num_leaves: { boosting_type: "goss" },
        },
      } as unknown as UiSchema,
    });

    const param = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "num_leaves");
    expect(param).toBeDefined();
    expect(param?.dataset.visible).toBe("true");
  });

  it("passes visible=false when conditional_visibility condition is not met", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { model: { name: "lgbm", boosting_type: "gbdt", params: {} } },
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "num_leaves", kind: "integer", label: "Num Leaves" },
        ],
        conditional_visibility: {
          num_leaves: { boosting_type: "goss" },
        },
      } as unknown as UiSchema,
    });

    const param = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "num_leaves");
    expect(param).toBeDefined();
    expect(param?.dataset.visible).toBe("false");
  });

  it("passes visible=true when condKey matches a value in model.params", () => {
    // Condition key resolved from model.params
    renderConfigForm({
      schema: minimalSchema,
      config: {
        model: { name: "lgbm", params: { boosting_type: "dart" } },
      },
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "num_leaves", kind: "integer", label: "Num Leaves" },
        ],
        conditional_visibility: {
          num_leaves: { boosting_type: "dart" },
        },
      } as unknown as UiSchema,
    });

    const param = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "num_leaves");
    expect(param?.dataset.visible).toBe("true");
  });

  it("passes visible=true when no conditional_visibility rule exists for the key", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "learning_rate", kind: "number", label: "LR" },
        ],
        conditional_visibility: {},
      } as unknown as UiSchema,
    });

    const param = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "learning_rate");
    expect(param?.dataset.visible).toBe("true");
  });
});

describe("ConfigForm — getOptionsForHint", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  const uiSchemaWithOptionSets = {
    parameter_hints: [
      { key: "objective", kind: "objective", label: "Objective" },
      { key: "metric", kind: "model_metric", label: "Metric" },
      { key: "learning_rate", kind: "number", label: "LR" },
    ],
    option_sets: {
      objective: { binary: ["binary", "cross_entropy"] },
      model_metric: { binary: ["auc", "binary_logloss"] },
    },
  } as unknown as UiSchema;

  it("passes objective options for task when kind is objective", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: "binary",
      uiSchema: uiSchemaWithOptionSets,
    });

    const objCall = dynParamCalls.find((c) => c.hint.key === "objective");
    expect(objCall).toBeDefined();
    expect(objCall?.options).toEqual(["binary", "cross_entropy"]);
  });

  it("passes model_metric options for task when kind is model_metric", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: "binary",
      uiSchema: uiSchemaWithOptionSets,
    });

    const metricCall = dynParamCalls.find((c) => c.hint.key === "metric");
    expect(metricCall).toBeDefined();
    expect(metricCall?.options).toEqual(["auc", "binary_logloss"]);
  });

  it("returns empty options for non-objective/model_metric kind", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: "binary",
      uiSchema: uiSchemaWithOptionSets,
    });

    const lrCall = dynParamCalls.find((c) => c.hint.key === "learning_rate");
    expect(lrCall).toBeDefined();
    expect(lrCall?.options).toEqual([]);
  });

  it("returns empty options when task is null", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: null,
      uiSchema: uiSchemaWithOptionSets,
    });

    for (const call of dynParamCalls) {
      expect(call.options).toEqual([]);
    }
  });
});

describe("ConfigForm — getValueForHint", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("returns model.params.objective for objective kind", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { model: { name: "lgbm", params: { objective: "binary" } } },
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "objective", kind: "objective", label: "Obj" },
        ],
      } as unknown as UiSchema,
    });

    const objCall = dynParamCalls.find((c) => c.hint.kind === "objective");
    expect(objCall?.value).toBe("binary");
  });

  it("returns model.params.metric for model_metric kind", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { model: { name: "lgbm", params: { metric: "auc" } } },
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "metric", kind: "model_metric", label: "Metric" },
        ],
      } as unknown as UiSchema,
    });

    const metricCall = dynParamCalls.find(
      (c) => c.hint.kind === "model_metric",
    );
    expect(metricCall?.value).toBe("auc");
  });

  it("returns model.params[key] for numeric kind", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { model: { name: "lgbm", params: { learning_rate: 0.05 } } },
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "learning_rate", kind: "number", label: "LR" },
        ],
      } as unknown as UiSchema,
    });

    const lrCall = dynParamCalls.find((c) => c.hint.key === "learning_rate");
    expect(lrCall?.value).toBe(0.05);
  });
});

describe("ConfigForm — handleHintChange (onChange propagation)", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("calls onChange with updated objective when objective DynParam changes", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange,
      uiSchema: {
        parameter_hints: [
          { key: "objective", kind: "objective", label: "Obj" },
        ],
      } as unknown as UiSchema,
    });

    // Simulate DynParam onChange via click (mock calls onChange("__changed__"))
    const dynParam = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "objective");
    fireEvent.click(dynParam!);

    expect(onChange).toHaveBeenCalled();
    const updatedConfig =
      onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(updatedConfig.model.params.objective).toBe("__changed__");
  });

  it("calls onChange with updated metric when model_metric DynParam changes", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange,
      uiSchema: {
        parameter_hints: [
          { key: "metric", kind: "model_metric", label: "Metric" },
        ],
      } as unknown as UiSchema,
    });

    const dynParam = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "metric");
    fireEvent.click(dynParam!);

    expect(onChange).toHaveBeenCalled();
    const updatedConfig =
      onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(updatedConfig.model.params.metric).toBe("__changed__");
  });

  it("calls onChange with updated numeric param when non-objective DynParam changes", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: { model: { name: "lgbm", params: { learning_rate: 0.1 } } },
      onChange,
      uiSchema: {
        parameter_hints: [
          { key: "learning_rate", kind: "number", label: "LR" },
        ],
      } as unknown as UiSchema,
    });

    const dynParam = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "learning_rate");
    fireEvent.click(dynParam!);

    expect(onChange).toHaveBeenCalled();
    const updatedConfig =
      onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(updatedConfig.model.params.learning_rate).toBe("__changed__");
  });
});

describe("ConfigForm — auto-select useEffect", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("auto-selects first objective option when model.params.objective is empty", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: { config_version: 1, model: { name: "lgbm", params: {} } },
      onChange,
      task: "binary",
      uiSchema: {
        parameter_hints: [],
        option_sets: {
          objective: { binary: ["binary", "cross_entropy"] },
        },
      } as unknown as UiSchema,
    });

    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    // Find a call that sets objective
    const objCall = calls.find(
      ([cfg]) => cfg?.model?.params?.objective !== undefined,
    );
    expect(objCall).toBeDefined();
    expect(objCall?.[0].model.params.objective).toBe("binary");
  });

  it("auto-selects first metric option when model.params.metric is empty", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: { config_version: 1, model: { name: "lgbm", params: {} } },
      onChange,
      task: "binary",
      uiSchema: {
        parameter_hints: [],
        option_sets: {
          model_metric: { binary: ["auc", "binary_logloss"] },
        },
      } as unknown as UiSchema,
    });

    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const metricCall = calls.find(
      ([cfg]) => cfg?.model?.params?.metric !== undefined,
    );
    expect(metricCall).toBeDefined();
    expect(metricCall?.[0].model.params.metric).toEqual(["auc"]);
  });

  it("does not auto-select objective when model.params.objective is already set", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: {
        model: { name: "lgbm", params: { objective: "cross_entropy" } },
      },
      onChange,
      task: "binary",
      uiSchema: {
        parameter_hints: [],
        option_sets: {
          objective: { binary: ["binary", "cross_entropy"] },
        },
      } as unknown as UiSchema,
    });

    // onChange should not be called for objective (already set)
    const objOverrideCalls = onChange.mock.calls.filter(
      ([cfg]) => cfg?.model?.params?.objective === "binary",
    );
    expect(objOverrideCalls.length).toBe(0);
  });

  it("does not auto-select when task is null", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: { config_version: 1, model: { name: "lgbm", params: {} } },
      onChange,
      task: null,
      uiSchema: {
        parameter_hints: [],
        option_sets: {
          objective: { binary: ["binary"] },
          model_metric: { binary: ["auc"] },
        },
      } as unknown as UiSchema,
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not auto-select objective/metric when option_sets is absent", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: { config_version: 1, model: { name: "lgbm", params: {} } },
      onChange,
      task: "binary",
      uiSchema: {
        parameter_hints: [],
      } as unknown as UiSchema,
    });

    // onChange may be called by MetricsChips (default metric selection), but
    // it must NOT be called to set model.params.objective or model.params.metric
    const objOrMetricCalls = onChange.mock.calls.filter(
      ([cfg]) =>
        cfg?.model?.params?.objective !== undefined ||
        cfg?.model?.params?.metric !== undefined,
    );
    expect(objOrMetricCalls.length).toBe(0);
  });

  // H-0062 Bugfix 2026-04-14 (3): task change must drop an objective /
  // metric that belongs to the old task. The original bug: a user
  // briefly selected task=multiclass (auto-setting objective=multiclass,
  // metric=[auc_mu, multi_logloss]) then switched back to task=binary.
  // The old auto-select useEffect guard was `!modelParams.objective`,
  // so it never overwrote the stale multiclass values, and the Tune
  // job failed with "All tuning trials failed" because LGBM rejects
  // a multiclass objective on a binary target.
  it("resets objective to new task default when current value is incompatible", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      // Incompatible state: task is binary but objective is multiclass.
      config: {
        config_version: 1,
        model: {
          name: "lgbm",
          params: { objective: "multiclass" },
        },
      },
      onChange,
      task: "binary",
      uiSchema: {
        parameter_hints: [],
        option_sets: {
          objective: {
            binary: ["binary", "cross_entropy"],
            multiclass: ["multiclass", "multiclassova"],
          },
        },
      } as unknown as UiSchema,
    });

    // At least one onChange call must carry a *binary-valid* objective.
    const resetCall = onChange.mock.calls.find(([cfg]) => {
      const obj = cfg?.model?.params?.objective;
      return obj === "binary" || obj === "cross_entropy";
    });
    expect(resetCall).toBeDefined();
  });

  it("resets metric to new task default when every value is incompatible", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: {
        config_version: 1,
        model: {
          name: "lgbm",
          // Incompatible state: task is binary but metric is multiclass-only.
          params: { metric: ["auc_mu", "multi_logloss"] },
        },
      },
      onChange,
      task: "binary",
      uiSchema: {
        parameter_hints: [
          {
            key: "metric",
            kind: "model_metric",
            default: {
              binary: ["auc", "binary_logloss"],
              multiclass: ["auc_mu", "multi_logloss"],
            },
          },
        ],
        option_sets: {
          model_metric: {
            binary: ["auc", "binary_logloss"],
            multiclass: ["auc_mu", "multi_logloss"],
          },
        },
      } as unknown as UiSchema,
    });

    // At least one onChange call must reset the metric to the binary
    // default. We look for *any* call whose metric is exactly the
    // binary default rather than `metric !== undefined` because the
    // controlled config keeps the stale value on every render, so the
    // first "metric defined" call would still be the stale one.
    const resetCall = onChange.mock.calls.find(([cfg]) => {
      const m = cfg?.model?.params?.metric;
      return (
        Array.isArray(m) &&
        m.length === 2 &&
        m[0] === "auc" &&
        m[1] === "binary_logloss"
      );
    });
    expect(resetCall).toBeDefined();
  });

  it("keeps objective/metric when they remain compatible with the task", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: {
        model: {
          name: "lgbm",
          params: {
            objective: "cross_entropy",
            metric: ["binary_logloss"],
          },
        },
      },
      onChange,
      task: "binary",
      uiSchema: {
        parameter_hints: [],
        option_sets: {
          objective: {
            binary: ["binary", "cross_entropy"],
          },
          model_metric: {
            binary: ["auc", "binary_logloss"],
          },
        },
      } as unknown as UiSchema,
    });

    // Neither objective nor metric should be overwritten.
    const overwrittenObj = onChange.mock.calls.find(
      ([cfg]) =>
        cfg?.model?.params?.objective !== undefined &&
        cfg?.model?.params?.objective !== "cross_entropy",
    );
    expect(overwrittenObj).toBeUndefined();
    const overwrittenMetric = onChange.mock.calls.find(
      ([cfg]) =>
        cfg?.model?.params?.metric !== undefined &&
        JSON.stringify(cfg.model.params.metric) !==
          JSON.stringify(["binary_logloss"]),
    );
    expect(overwrittenMetric).toBeUndefined();
  });
});

describe("ConfigForm — inner_valid_options (Inner Validation select)", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  const schemaWithTraining = {
    properties: {
      model: {
        type: "object",
        title: "Model",
        properties: {
          name: { type: "string", const: "lgbm" },
          params: { type: "object", additionalProperties: true },
        },
      },
      training: {
        type: "object",
        title: "Training",
        properties: {
          early_stopping: {
            type: "object",
            properties: {
              enabled: { type: "boolean", default: true },
            },
          },
        },
      },
    },
    $defs: {},
  };

  it("renders Inner Validation select when inner_valid_options and early_stopping enabled", () => {
    renderConfigForm({
      schema: schemaWithTraining,
      config: {
        model: { name: "lgbm", params: {} },
        training: { early_stopping: { enabled: true } },
      },
      onChange: vi.fn(),
      uiSchema: {
        inner_valid_options: ["holdout", "cv"],
      } as unknown as UiSchema,
    });

    expect(screen.getByText("Inner Validation")).toBeInTheDocument();
  });

  it("does not render Inner Validation select when early_stopping is disabled", () => {
    renderConfigForm({
      schema: schemaWithTraining,
      config: {
        model: { name: "lgbm", params: {} },
        training: { early_stopping: { enabled: false } },
      },
      onChange: vi.fn(),
      uiSchema: {
        inner_valid_options: ["holdout", "cv"],
      } as unknown as UiSchema,
    });

    expect(screen.queryByText("Inner Validation")).not.toBeInTheDocument();
  });

  it("does not render Inner Validation select when inner_valid_options is absent", () => {
    renderConfigForm({
      schema: schemaWithTraining,
      config: {
        model: { name: "lgbm", params: {} },
        training: { early_stopping: { enabled: true } },
      },
      onChange: vi.fn(),
    });

    expect(screen.queryByText("Inner Validation")).not.toBeInTheDocument();
  });

  it("reads inner_valid.method from training.early_stopping.inner_valid (H-2)", () => {
    // H-2 regression: the read site used to look at
    // ``trainingConfig.inner_valid`` (top-level), which is the
    // ``Extra inputs are not permitted`` path. The Select must
    // reflect the canonical nested path the backend accepts.
    renderConfigForm({
      schema: schemaWithTraining,
      config: {
        model: { name: "lgbm", params: {} },
        training: {
          early_stopping: {
            enabled: true,
            inner_valid: { method: "cv", ratio: 0.2 },
          },
        },
      },
      onChange: vi.fn(),
      uiSchema: {
        inner_valid_options: ["holdout", "cv"],
      } as unknown as UiSchema,
    });

    // The Select renders its current value as visible text inside
    // the trigger. Read it from the trigger's accessible name.
    const trigger = screen.getByLabelText("Inner validation method");
    expect(trigger).toHaveTextContent("cv");
  });

  it("writes Inner Validation method change to training.early_stopping.inner_valid (H-2)", () => {
    // H-2 regression: the user-driven Select onValueChange used to
    // emit ``["training", "inner_valid", "method"]``, which lizyml
    // rejects with ``Extra inputs are not permitted``. The auto-reset
    // effect was already migrated in P-0092 Phase 2 — this test pins
    // the write half of the same surface.
    const onChange = vi.fn();
    renderConfigForm({
      schema: schemaWithTraining,
      config: {
        model: { name: "lgbm", params: {} },
        training: {
          early_stopping: {
            enabled: true,
            inner_valid: { method: "holdout", ratio: 0.2 },
          },
        },
      },
      onChange,
      uiSchema: {
        inner_valid_options: ["holdout", "cv"],
      } as unknown as UiSchema,
    });

    // Open the Select and pick "cv". Radix's Select renders options in
    // a portal — open via keyboard so the listbox mounts deterministically
    // even in jsdom (where pointer events are simulated, not real).
    const trigger = screen.getByLabelText("Inner validation method");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const cvOption = screen.getByRole("option", { name: "cv" });
    fireEvent.click(cvOption);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1);
    const nextConfig = lastCall?.[0] as Record<string, unknown>;
    const written = (
      (
        (nextConfig.training as Record<string, unknown>)
          ?.early_stopping as Record<string, unknown>
      )?.inner_valid as Record<string, unknown>
    )?.method;
    expect(written).toBe("cv");
    // The legacy top-level path must NOT be touched — that was the
    // P-0087 ``Extra inputs are not permitted`` regression.
    expect(
      (nextConfig.training as Record<string, unknown>)?.inner_valid,
    ).toBeUndefined();
  });
});

describe("ConfigForm — Calibration section edge cases", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("does not render Calibration for multiclass task without conditional_visibility", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "multiclass",
    });

    expect(screen.queryByText("Calibration")).not.toBeInTheDocument();
  });

  it("renders Calibration for multiclass when conditional_visibility includes multiclass", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "multiclass",
      uiSchema: {
        conditional_visibility: {
          calibration: { task: ["binary", "multiclass"] },
        },
      } as unknown as UiSchema,
    });

    expect(screen.getByText("Calibration")).toBeInTheDocument();
  });

  it("does not render Calibration when task is null (even with binary default logic)", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: null,
    });

    expect(screen.queryByText("Calibration")).not.toBeInTheDocument();
  });

  it("renders Calibration for binary task when conditional_visibility calVis.task is non-array (fallback)", () => {
    // calVis exists but task is not an array → calVis condition not met → show=false
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "binary",
      uiSchema: {
        conditional_visibility: {
          // task is NOT an array → Array.isArray returns false → showCal = false
          calibration: { task: "binary" },
        },
      } as unknown as UiSchema,
    });

    // Non-array calVis.task → showCal evaluates to false
    expect(screen.queryByText("Calibration")).not.toBeInTheDocument();
  });
});

describe("ConfigForm — MetricsChips integration", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("renders MetricsChips within Evaluation section when task is set", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: "binary",
    });

    // Evaluation accordion section is expanded by default
    expect(screen.getByText("Evaluation")).toBeInTheDocument();
  });

  it("passes metricsByTask from uiSchema option_sets.metric to MetricsChips", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: {
        ...minimalConfig,
        evaluation: { metrics: [] },
      },
      onChange: vi.fn(),
      task: "binary",
      uiSchema: {
        option_sets: {
          metric: {
            binary: ["auc", "ks", "logloss"],
          },
        },
      } as unknown as UiSchema,
    });

    // MetricsChips renders chip labels from the metric list
    expect(screen.getByText("auc")).toBeInTheDocument();
    expect(screen.getByText("ks")).toBeInTheDocument();
  });
});

describe("ConfigForm — top-level scalar fields rendering", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("renders scalar top-level fields that are not hidden or data-panel fields", () => {
    const schemaWithScalar = {
      properties: {
        model: {
          type: "object",
          title: "Model",
          properties: {
            name: { type: "string", const: "lgbm" },
            params: { type: "object", additionalProperties: true },
          },
        },
        // A scalar field that is not in HIDDEN or DATA_PANEL_FIELDS
        random_seed: { type: "integer", title: "Random Seed" },
      },
      $defs: {},
    };

    renderConfigForm({
      schema: schemaWithScalar,
      config: { model: { name: "lgbm", params: {} }, random_seed: 42 },
      onChange: vi.fn(),
    });

    expect(screen.getByText("Random Seed")).toBeInTheDocument();
  });
});

describe("ConfigForm — CalibrationSection onChange propagation", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("calls onChange with updated calibration when CalibrationSection toggle fires", () => {
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange,
      task: "binary",
    });

    // CalibrationSection renders a Switch inside the Calibration accordion item.
    // Use the "Calibration" heading's parent container to scope the query.
    const calibrationHeading = screen.getByText("Calibration");
    const calibrationSection = calibrationHeading.closest(
      '[data-slot="accordion-item"]',
    ) as HTMLElement;
    const toggle = within(calibrationSection).getByRole("switch");
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalled();
    // After toggling ON (was null), calibration should be set to defaults (non-null object)
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.calibration).not.toBeNull();
    expect(typeof lastCall.calibration).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// Issue #253 — ConfigForm onChange handlers must use the latest snapshot
// (`configRef.current`), not the captured `config` prop. Two writes in the
// same render tick must both land in the final onChange payload.
// ---------------------------------------------------------------------------

describe("ConfigForm — Issue #253 configRef (two writes in same tick)", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("preserves the first write when a second DynParam write fires in the same tick (numeric branch)", () => {
    // Two essential DynParams fire onChange back-to-back without the parent
    // re-rendering (simulates batched React updates + effect-driven writes
    // that all target the same commit). If the numeric branch of
    // handleHintChange still reads the captured `config`, the second write
    // rebuilds params from the stale snapshot and loses the first write.
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: {
        model: {
          name: "lgbm",
          params: { learning_rate: 0.1, max_depth: 6 },
        },
      },
      onChange,
      uiSchema: {
        parameter_hints: [
          { key: "learning_rate", kind: "number", label: "LR" },
          { key: "max_depth", kind: "integer", label: "Depth" },
        ],
      } as unknown as UiSchema,
    });

    const lrParam = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "learning_rate");
    const depthParam = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "max_depth");

    // Fire both writes before the parent re-renders with the new config.
    fireEvent.click(lrParam!);
    fireEvent.click(depthParam!);

    // The last onChange call represents the final state the backend would
    // observe. Both writes must be present — neither may be overwritten by
    // a stale-snapshot rebuild.
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.model.params.learning_rate).toBe("__changed__");
    expect(lastCall.model.params.max_depth).toBe("__changed__");
  });

  it("preserves a prior handleHintChange write when FeatureWeightsEditor writes in the same tick", () => {
    // handleHintChange (objective) goes through handleFieldChange →
    // configRef. FeatureWeightsEditor.onChange must also use configRef, or
    // its write rebuilds config from the stale snapshot and drops the
    // objective change.
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: {
        model: { name: "lgbm", params: {}, feature_weights: null },
      },
      onChange,
      columns: ["age"],
      uiSchema: {
        parameter_hints: [
          { key: "objective", kind: "objective", label: "Obj" },
        ],
      } as unknown as UiSchema,
    });

    // 1. Objective change (goes via handleFieldChange / configRef)
    const objParam = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "objective");
    fireEvent.click(objParam!);

    // 2. FeatureWeightsEditor ON (Switch). Before the parent re-renders
    //    with the new config from step 1.
    const weightsSwitch = screen.getByLabelText(/enable feature weights/i);
    fireEvent.click(weightsSwitch);

    // The final onChange payload must carry BOTH: the objective set in
    // step 1 and the feature_weights toggle from step 2.
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.model.params.objective).toBe("__changed__");
    expect(lastCall.model.feature_weights).toEqual({});
  });

  it("preserves a prior handleHintChange write when CalibrationSection toggles in the same tick", () => {
    // CalibrationSection is the last onChange site migrated to
    // handleFieldChange. Same race shape: objective set first via
    // handleFieldChange, then CalibrationSection writes calibration.
    const onChange = vi.fn();
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange,
      task: "binary",
      uiSchema: {
        parameter_hints: [
          { key: "objective", kind: "objective", label: "Obj" },
        ],
      } as unknown as UiSchema,
    });

    const objParam = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "objective");
    fireEvent.click(objParam!);

    // Toggle calibration ON (null → defaults object)
    const calibrationHeading = screen.getByText("Calibration");
    const calibrationSection = calibrationHeading.closest(
      '[data-slot="accordion-item"]',
    ) as HTMLElement;
    const toggle = within(calibrationSection).getByRole("switch");
    fireEvent.click(toggle);

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.model.params.objective).toBe("__changed__");
    expect(lastCall.calibration).not.toBeNull();
    expect(typeof lastCall.calibration).toBe("object");
  });
});

describe("ConfigForm — advanced DynParam onChange propagation", () => {
  afterEach(() => {
    cleanup();
    dynParamCalls.length = 0;
  });

  it("calls onChange with updated param when an advanced DynParam changes", () => {
    const onChange = vi.fn();
    const uiSchemaWithAdvanced = {
      parameter_hints: [
        // essential (shows by default)
        { key: "objective", kind: "objective", label: "Objective" },
        // advanced (hidden until toggle clicked) — use a non-essential key
        { key: "feature_fraction", kind: "number", label: "FF" },
      ],
    } as unknown as UiSchema;

    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange,
      uiSchema: uiSchemaWithAdvanced,
    });

    // Reveal advanced params
    fireEvent.click(screen.getByTestId("toggle-advanced-params"));

    // Click the advanced DynParam (feature_fraction)
    const advancedParam = screen
      .getAllByTestId("dyn-param")
      .find((el) => el.dataset.hintKey === "feature_fraction");
    expect(advancedParam).toBeDefined();
    fireEvent.click(advancedParam!);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.model.params.feature_fraction).toBe("__changed__");
  });
});
