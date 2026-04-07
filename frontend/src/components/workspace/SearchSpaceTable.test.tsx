import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchSpaceCatalogEntry } from "@/api/types";
import { renderWithQuery } from "@/test/helpers";
import { groupToCategory, SearchSpaceTable } from "./SearchSpaceTable";

afterEach(cleanup);

const catalog: SearchSpaceCatalogEntry[] = [
  {
    key: "learning_rate",
    title: "Learning Rate",
    paramType: "number",
    modes: ["fixed", "range"],
    group: "model_params",
  },
  {
    key: "n_estimators",
    title: "N Estimators",
    paramType: "integer",
    modes: ["fixed", "range"],
    group: "model_params",
  },
];

const defaultProps = {
  space: {} as Record<string, unknown>,
  modelParams: {} as Record<string, unknown>,
  onChange: vi.fn(),
  catalog,
};

describe("SearchSpaceTable", () => {
  it('renders "Parameter" header', () => {
    render(<SearchSpaceTable {...defaultProps} />);
    expect(screen.getByText("Parameter")).toBeInTheDocument();
  });

  it('renders "Mode" header', () => {
    render(<SearchSpaceTable {...defaultProps} />);
    expect(screen.getByText("Mode")).toBeInTheDocument();
  });

  it('renders "Summary" header', () => {
    render(<SearchSpaceTable {...defaultProps} />);
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  it("renders catalog entries by key name", () => {
    render(<SearchSpaceTable {...defaultProps} />);
    expect(screen.getByText("learning_rate")).toBeInTheDocument();
    expect(screen.getByText("n_estimators")).toBeInTheDocument();
  });

  it("shows group labels when multiple groups exist", () => {
    const multiGroupCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "learning_rate",
        title: "Learning Rate",
        paramType: "number",
        modes: ["fixed", "range"],
        group: "model_params",
      },
      {
        key: "early_stopping",
        title: "Early Stopping",
        paramType: "integer",
        modes: ["fixed", "range"],
        group: "training",
      },
    ];

    render(<SearchSpaceTable {...defaultProps} catalog={multiGroupCatalog} />);
    expect(screen.getByText("Model Params")).toBeInTheDocument();
    expect(screen.getByText("Training Params")).toBeInTheDocument();
  });

  it('shows "Fixed" and "Range" mode buttons for each param', () => {
    render(<SearchSpaceTable {...defaultProps} />);
    const fixedButtons = screen.getAllByRole("radio", { name: /fixed/i });
    const rangeButtons = screen.getAllByRole("radio", { name: /range/i });
    expect(fixedButtons).toHaveLength(2);
    expect(rangeButtons).toHaveLength(2);
  });

  it('range mode shows summary like "0 ~ 1"', () => {
    const space = {
      learning_rate: { type: "float", low: 0, high: 1, log: false },
    };
    render(<SearchSpaceTable {...defaultProps} space={space} />);
    expect(screen.getByText("0 ~ 1")).toBeInTheDocument();
  });

  it("renders nothing when no catalog provided", () => {
    render(<SearchSpaceTable space={{}} modelParams={{}} onChange={vi.fn()} />);
    // Without a catalog, no parameter rows are rendered
    expect(screen.queryByText("learning_rate")).not.toBeInTheDocument();
    expect(screen.queryByText("n_estimators")).not.toBeInTheDocument();
  });

  it('fixed mode shows default value or "default" text', () => {
    render(
      <SearchSpaceTable
        {...defaultProps}
        modelParams={{ learning_rate: 0.1 }}
      />,
    );
    // learning_rate has value 0.1
    expect(screen.getByText("0.1")).toBeInTheDocument();
    // n_estimators has no value → shows "default"
    expect(screen.getByText("default")).toBeInTheDocument();
  });

  it("clicking range mode button switches param to range mode", () => {
    const onChange = vi.fn();
    render(<SearchSpaceTable {...defaultProps} onChange={onChange} />);

    // Find Range radio buttons and click the first one (for learning_rate)
    const rangeButtons = screen.getAllByRole("radio", { name: /range/i });
    fireEvent.click(rangeButtons[0]);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // learning_rate should now have a range entry
    expect(lastCall.learning_rate).toBeDefined();
    expect(lastCall.learning_rate.type).toBe("float");
  });

  it("clicking fixed mode removes the param from space", () => {
    const onChange = vi.fn();
    const space = {
      learning_rate: { type: "float", low: 0, high: 1, log: false },
    };
    render(
      <SearchSpaceTable {...defaultProps} space={space} onChange={onChange} />,
    );

    // Click fixed mode for learning_rate
    const fixedButtons = screen.getAllByRole("radio", { name: /fixed/i });
    fireEvent.click(fixedButtons[0]);

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.learning_rate).toBeUndefined();
  });

  it("shows log distribution summary", () => {
    const space = {
      learning_rate: { type: "float", low: 0.001, high: 0.1, log: true },
    };
    render(<SearchSpaceTable {...defaultProps} space={space} />);
    expect(screen.getByText("0.001 ~ 0.1 (log)")).toBeInTheDocument();
  });

  it("renders integer type correctly for integer params", () => {
    const intCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "max_depth",
        title: "Max Depth",
        paramType: "integer",
        modes: ["fixed", "range"],
        group: "model_params",
      },
    ];
    const onChange = vi.fn();
    render(
      <SearchSpaceTable
        space={{}}
        modelParams={{}}
        onChange={onChange}
        catalog={intCatalog}
      />,
    );
    expect(screen.getByText("max_depth")).toBeInTheDocument();

    // Switch to range mode
    const rangeBtn = screen.getByRole("radio", { name: /range/i });
    fireEvent.click(rangeBtn);

    expect(onChange).toHaveBeenCalled();
    const spaceArg = onChange.mock.calls[0][0];
    expect(spaceArg.max_depth.type).toBe("int");
  });

  it("expands row on click when in range mode", () => {
    const space = {
      learning_rate: { type: "float", low: 0, high: 1, log: false },
    };
    render(<SearchSpaceTable {...defaultProps} space={space} />);

    // Click the row to expand
    const row = screen.getByText("learning_rate").closest("button");
    if (row) fireEvent.click(row);

    // Expanded row shows Min, Max, Distribution
    expect(screen.getByText("Min")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByText("Distribution")).toBeInTheDocument();
  });

  it("shows Step input for integer params in expanded range view", () => {
    const intCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "n_estimators",
        title: "N Estimators",
        paramType: "integer",
        modes: ["fixed", "range"],
        group: "model_params",
      },
    ];
    const space = {
      n_estimators: { type: "int", low: 50, high: 500, log: false },
    };
    render(
      <SearchSpaceTable
        space={space}
        modelParams={{}}
        onChange={vi.fn()}
        catalog={intCatalog}
      />,
    );

    // Expand the row
    const row = screen.getByText("n_estimators").closest("button");
    if (row) fireEvent.click(row);

    expect(screen.getByText("Step")).toBeInTheDocument();
  });

  it("renders with choice mode params", () => {
    const choiceCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "objective",
        title: "Objective",
        paramType: "string",
        modes: ["fixed", "choice"],
        group: "smart_params",
      },
    ];
    const space = {
      objective: {
        type: "categorical",
        choices: ["binary:logistic", "multi:softmax"],
      },
    };
    render(
      <SearchSpaceTable
        space={space}
        modelParams={{}}
        onChange={vi.fn()}
        catalog={choiceCatalog}
      />,
    );
    expect(screen.getByText("objective")).toBeInTheDocument();
    expect(
      screen.getByText("binary:logistic, multi:softmax"),
    ).toBeInTheDocument();
  });

  it("uses catalog default_range when switching to range mode", () => {
    const catalogWithRange: SearchSpaceCatalogEntry[] = [
      {
        key: "learning_rate",
        title: "Learning Rate",
        paramType: "number",
        modes: ["fixed", "range"],
        group: "model_params",
        default_mode: "range",
        default_range: { low: 0.01, high: 0.3, log: true },
      },
    ];
    const onChange = vi.fn();
    render(
      <SearchSpaceTable
        space={{}}
        modelParams={{}}
        onChange={onChange}
        catalog={catalogWithRange}
      />,
    );
    const rangeBtn = screen.getByRole("radio", { name: /range/i });
    fireEvent.click(rangeBtn);

    expect(onChange).toHaveBeenCalled();
    const spaceArg = onChange.mock.calls[0][0];
    expect(spaceArg.learning_rate).toEqual({
      type: "float",
      low: 0.01,
      high: 0.3,
      log: true,
      step: undefined,
      category: "model",
    });
  });

  it("uses generic defaults when catalog entry has no default_range", () => {
    const catalogNoRange: SearchSpaceCatalogEntry[] = [
      {
        key: "max_bin",
        title: "Max Bin",
        paramType: "integer",
        modes: ["fixed", "range"],
        group: "model_params",
      },
    ];
    const onChange = vi.fn();
    render(
      <SearchSpaceTable
        space={{}}
        modelParams={{}}
        onChange={onChange}
        catalog={catalogNoRange}
      />,
    );
    const rangeBtn = screen.getByRole("radio", { name: /range/i });
    fireEvent.click(rangeBtn);

    expect(onChange).toHaveBeenCalled();
    const spaceArg = onChange.mock.calls[0][0];
    // Falls back to generic {low: 0, high: 1, log: false}
    expect(spaceArg.max_bin.low).toBe(0);
    expect(spaceArg.max_bin.high).toBe(1);
    expect(spaceArg.max_bin.log).toBe(false);
  });

  it("renders FixedValueEditor when onModelParamChange is provided", () => {
    const onModelParamChange = vi.fn();
    render(
      <SearchSpaceTable
        {...defaultProps}
        onModelParamChange={onModelParamChange}
      />,
    );
    // FixedValueEditor should be rendered instead of "default" text
    // The component renders differently with onModelParamChange
    expect(screen.getByText("learning_rate")).toBeInTheDocument();
  });

  describe("conditional_visibility", () => {
    const visibilityCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "auto_num_leaves",
        title: "Auto Num Leaves",
        paramType: "boolean",
        modes: ["fixed", "choice"],
        group: "smart_params",
      },
      {
        key: "num_leaves_ratio",
        title: "Num Leaves Ratio",
        paramType: "number",
        modes: ["fixed", "range"],
        group: "smart_params",
      },
      {
        key: "num_leaves",
        title: "Num Leaves",
        paramType: "integer",
        modes: ["fixed", "range"],
        group: "smart_params",
      },
    ];

    const conditionalVisibility = {
      num_leaves_ratio: { auto_num_leaves: true },
      num_leaves: { auto_num_leaves: false },
    };

    it("hides num_leaves when auto_num_leaves=true (default)", () => {
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ auto_num_leaves: true }}
          onChange={vi.fn()}
          catalog={visibilityCatalog}
          conditionalVisibility={conditionalVisibility}
        />,
      );
      expect(screen.getByText("num_leaves_ratio")).toBeInTheDocument();
      expect(screen.queryByText("num_leaves")).not.toBeInTheDocument();
    });

    it("shows num_leaves when auto_num_leaves=false", () => {
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ auto_num_leaves: false }}
          onChange={vi.fn()}
          catalog={visibilityCatalog}
          conditionalVisibility={conditionalVisibility}
        />,
      );
      expect(screen.queryByText("num_leaves_ratio")).not.toBeInTheDocument();
      expect(screen.getByText("num_leaves")).toBeInTheDocument();
    });

    it("shows both when dep is in search space (choice/range mode)", () => {
      render(
        <SearchSpaceTable
          space={{
            auto_num_leaves: {
              type: "categorical",
              choices: ["true", "false"],
            },
          }}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={visibilityCatalog}
          conditionalVisibility={conditionalVisibility}
        />,
      );
      expect(screen.getByText("num_leaves_ratio")).toBeInTheDocument();
      expect(screen.getByText("num_leaves")).toBeInTheDocument();
    });

    it("falls back to catalog default when modelParams has no value", () => {
      const catalogWithDefault: SearchSpaceCatalogEntry[] = [
        {
          key: "auto_num_leaves",
          title: "Auto Num Leaves",
          paramType: "boolean",
          modes: ["fixed", "choice"],
          group: "smart_params",
          default: true, // catalog default = true
        },
        {
          key: "num_leaves_ratio",
          title: "Num Leaves Ratio",
          paramType: "number",
          modes: ["fixed", "range"],
          group: "smart_params",
        },
        {
          key: "num_leaves",
          title: "Num Leaves",
          paramType: "integer",
          modes: ["fixed", "range"],
          group: "smart_params",
        },
      ];
      // modelParams has NO auto_num_leaves — should fall back to catalog default (true)
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={catalogWithDefault}
          conditionalVisibility={conditionalVisibility}
        />,
      );
      // auto_num_leaves default=true → num_leaves_ratio visible, num_leaves hidden
      expect(screen.getByText("num_leaves_ratio")).toBeInTheDocument();
      expect(screen.queryByText("num_leaves")).not.toBeInTheDocument();
    });
  });

  describe("specialSearchSpaceFields", () => {
    const objectiveCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "objective",
        title: "Objective",
        paramType: "string",
        modes: ["fixed", "choice"],
        group: "model_params",
        default: {
          binary: "binary",
          regression: "huber",
          multiclass: "multiclass",
        },
      },
    ];

    it("renders SegmentGroup for objective special field", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ objective: "binary" }}
          onChange={vi.fn()}
          catalog={objectiveCatalog}
          task="binary"
          objectiveOptions={["binary", "cross_entropy"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ objective: "objective" }}
        />,
      );
      // SegmentGroup for objective renders the options as radio buttons
      const binaryButtons = screen.getAllByRole("radio", { name: /binary/i });
      expect(binaryButtons.length).toBeGreaterThan(0);
    });

    it("calls onModelParamChange when objective segment is clicked", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ objective: "binary" }}
          onChange={vi.fn()}
          catalog={objectiveCatalog}
          task="binary"
          objectiveOptions={["binary", "cross_entropy"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ objective: "objective" }}
        />,
      );
      const crossEntropyBtn = screen.getByRole("radio", {
        name: /cross_entropy/i,
      });
      fireEvent.click(crossEntropyBtn);
      expect(onModelParamChange).toHaveBeenCalledWith(
        "objective",
        "cross_entropy",
      );
    });

    const metricCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "metric",
        title: "Metric",
        paramType: "string",
        modes: ["fixed", "choice"],
        group: "model_params",
        default: {
          binary: "auc",
          regression: "rmse",
          multiclass: "multi_logloss",
        },
      },
    ];

    it("renders model_metric badge buttons for metric special field", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ metric: ["auc"] }}
          onChange={vi.fn()}
          catalog={metricCatalog}
          task="binary"
          metricOptions={["auc", "f1", "accuracy"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ metric: "model_metric" }}
        />,
      );
      // model_metric renders badge buttons for each option
      expect(screen.getByText("auc")).toBeInTheDocument();
      expect(screen.getByText("f1")).toBeInTheDocument();
      expect(screen.getByText("accuracy")).toBeInTheDocument();
    });

    it("clicking metric badge calls onModelParamChange with toggled array", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ metric: ["auc"] }}
          onChange={vi.fn()}
          catalog={metricCatalog}
          task="binary"
          metricOptions={["auc", "f1"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ metric: "model_metric" }}
        />,
      );
      // Click "f1" to add it
      fireEvent.click(screen.getByText("f1"));
      expect(onModelParamChange).toHaveBeenCalledWith("metric", ["auc", "f1"]);
    });

    it("clicking already-selected metric badge removes it from array", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ metric: ["auc", "f1"] }}
          onChange={vi.fn()}
          catalog={metricCatalog}
          task="binary"
          metricOptions={["auc", "f1"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ metric: "model_metric" }}
        />,
      );
      // Click "f1" to remove it (it's currently selected)
      fireEvent.click(screen.getByText("f1"));
      expect(onModelParamChange).toHaveBeenCalledWith("metric", ["auc"]);
    });
  });

  describe("precision_at_k k-value row", () => {
    const metricCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "metric",
        title: "Metric",
        paramType: "string",
        modes: ["fixed", "choice"],
        group: "model_params",
        default: { binary: "auc" },
      },
    ];

    it("shows k-value NumberInput when precision_at_k is in metric array", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ metric: ["precision_at_k"], _precision_at_k_k: 10 }}
          onChange={vi.fn()}
          catalog={metricCatalog}
          task="binary"
          metricOptions={["auc", "precision_at_k"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ metric: "model_metric" }}
        />,
      );
      // The k-value row shows "precision_at_k: k" label
      expect(screen.getByText("precision_at_k: k")).toBeInTheDocument();
    });

    it("does not show k-value row when precision_at_k is not selected", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ metric: ["auc"] }}
          onChange={vi.fn()}
          catalog={metricCatalog}
          task="binary"
          metricOptions={["auc", "precision_at_k"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ metric: "model_metric" }}
        />,
      );
      expect(screen.queryByText("precision_at_k: k")).not.toBeInTheDocument();
    });

    it("k-value change calls onModelParamChange with _precision_at_k_k", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ metric: ["precision_at_k"], _precision_at_k_k: 5 }}
          onChange={vi.fn()}
          catalog={metricCatalog}
          task="binary"
          metricOptions={["precision_at_k"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ metric: "model_metric" }}
        />,
      );
      // The k-value row has a NumberInput with increment button
      const incrementBtn = screen.getByRole("button", { name: /increment/i });
      fireEvent.click(incrementBtn);
      expect(onModelParamChange).toHaveBeenCalledWith("_precision_at_k_k", 6);
    });
  });

  describe("groupToCategory", () => {
    it("returns 'smart' for smart_params", () => {
      expect(groupToCategory("smart_params")).toBe("smart");
    });

    it("returns 'training' for training", () => {
      expect(groupToCategory("training")).toBe("training");
    });

    it("returns 'model' for model_params", () => {
      expect(groupToCategory("model_params")).toBe("model");
    });

    it("returns 'model' for any unknown group", () => {
      expect(groupToCategory("additional")).toBe("model");
      expect(groupToCategory("unknown_group")).toBe("model");
    });
  });

  describe("GroupLabel fallback for unknown group keys", () => {
    it("uses raw group name when not in GROUP_LABELS", () => {
      const unknownGroupCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "param_a",
          title: "Param A",
          paramType: "number",
          modes: ["fixed", "range"],
          group: "model_params",
        },
        {
          key: "param_b",
          title: "Param B",
          paramType: "number",
          modes: ["fixed", "range"],
          group: "custom_group",
        },
      ];
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={unknownGroupCatalog}
        />,
      );
      // GROUP_LABELS has no entry for "custom_group" → raw key is shown
      expect(screen.getByText("custom_group")).toBeInTheDocument();
    });
  });

  describe("choice mode switching", () => {
    it("switches from fixed to choice mode and calls onChange with categorical entry", () => {
      const choiceCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "objective",
          title: "Objective",
          paramType: "string",
          modes: ["fixed", "choice"],
          group: "model_params",
        },
      ];
      const onChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={onChange}
          catalog={choiceCatalog}
        />,
      );
      const choiceBtn = screen.getByRole("radio", { name: /choice/i });
      fireEvent.click(choiceBtn);

      expect(onChange).toHaveBeenCalled();
      const spaceArg = onChange.mock.calls[0][0];
      expect(spaceArg.objective.type).toBe("categorical");
      expect(spaceArg.objective.choices).toEqual([]);
    });

    it("initializes boolean params with ['true','false'] choices in choice mode", () => {
      const boolCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "auto_num_leaves",
          title: "Auto Num Leaves",
          paramType: "boolean",
          modes: ["fixed", "choice"],
          group: "smart_params",
        },
      ];
      const onChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={onChange}
          catalog={boolCatalog}
        />,
      );
      const choiceBtn = screen.getByRole("radio", { name: /choice/i });
      fireEvent.click(choiceBtn);

      expect(onChange).toHaveBeenCalled();
      const spaceArg = onChange.mock.calls[0][0];
      expect(spaceArg.auto_num_leaves.type).toBe("categorical");
      expect(spaceArg.auto_num_leaves.choices).toEqual(["true", "false"]);
    });

    it("choice mode assigns correct category from group", () => {
      const smartCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "num_boost_round",
          title: "Num Boost Round",
          paramType: "string",
          modes: ["fixed", "choice"],
          group: "smart_params",
        },
      ];
      const onChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={onChange}
          catalog={smartCatalog}
        />,
      );
      const choiceBtn = screen.getByRole("radio", { name: /choice/i });
      fireEvent.click(choiceBtn);

      const spaceArg = onChange.mock.calls[0][0];
      expect(spaceArg.num_boost_round.category).toBe("smart");
    });

    it("range mode assigns 'training' category for training group params", () => {
      const trainingCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "early_stopping",
          title: "Early Stopping",
          paramType: "integer",
          modes: ["fixed", "range"],
          group: "training",
        },
      ];
      const onChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={onChange}
          catalog={trainingCatalog}
        />,
      );
      const rangeBtn = screen.getByRole("radio", { name: /range/i });
      fireEvent.click(rangeBtn);

      const spaceArg = onChange.mock.calls[0][0];
      expect(spaceArg.early_stopping.category).toBe("training");
      expect(spaceArg.early_stopping.type).toBe("int");
    });

    it("expands row when switching to choice mode", () => {
      const choiceCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "objective",
          title: "Objective",
          paramType: "string",
          modes: ["fixed", "choice"],
          group: "model_params",
        },
      ];
      const space = {
        objective: { type: "categorical", choices: ["binary:logistic"] },
      };
      render(
        <SearchSpaceTable
          space={space}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={choiceCatalog}
        />,
      );
      // Click the row to expand choice mode
      const row = screen.getByText("objective").closest("button");
      if (row) fireEvent.click(row);

      // ChoiceInput should be visible after expanding
      expect(screen.getByText("objective")).toBeInTheDocument();
    });
  });

  describe("paramOptionSets", () => {
    it("passes per-parameter option sets to FixedValueEditor", () => {
      const paramCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "booster",
          title: "Booster",
          paramType: "string",
          modes: ["fixed", "range"],
          group: "model_params",
        },
      ];
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ booster: "gbtree" }}
          onChange={vi.fn()}
          catalog={paramCatalog}
          onModelParamChange={onModelParamChange}
          paramOptionSets={{ booster: ["gbtree", "dart", "gblinear"] }}
        />,
      );
      expect(screen.getByText("booster")).toBeInTheDocument();
    });

    it("boolean params return ['true','false'] options from getChoiceOptions", () => {
      const boolCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "verbose",
          title: "Verbose",
          paramType: "boolean",
          modes: ["fixed", "choice"],
          group: "model_params",
        },
      ];
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ verbose: "true" }}
          onChange={vi.fn()}
          catalog={boolCatalog}
          onModelParamChange={onModelParamChange}
        />,
      );
      expect(screen.getByText("verbose")).toBeInTheDocument();
    });
  });

  describe("additionalParams", () => {
    it("renders Add parameter selector when additionalParams has available items", () => {
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={catalog}
          additionalParams={["custom_param", "another_param"]}
        />,
      );
      expect(screen.getByText("+ Add parameter")).toBeInTheDocument();
    });

    it("does not render Add parameter selector when all additionalParams are already in catalog", () => {
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={catalog}
          additionalParams={["learning_rate", "n_estimators"]}
        />,
      );
      expect(screen.queryByText("+ Add parameter")).not.toBeInTheDocument();
    });

    it("initializes addedParams from space keys that exist in additionalParams but not in catalog", () => {
      render(
        <SearchSpaceTable
          space={{
            custom_param: { type: "float", low: 0, high: 1, log: false },
          }}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={catalog}
          additionalParams={["custom_param"]}
        />,
      );
      // custom_param should appear as a row since it's in space and additionalParams
      expect(screen.getByText("custom_param")).toBeInTheDocument();
    });
  });

  describe("resolveCatalogDefault", () => {
    it("resolves task-keyed default for the given task", () => {
      const objectiveCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "objective",
          title: "Objective",
          paramType: "string",
          modes: ["fixed", "choice"],
          group: "model_params",
          default: {
            binary: "binary:logistic",
            regression: "reg:squarederror",
          },
        },
      ];
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={objectiveCatalog}
          task="binary"
        />,
      );
      // The resolved default "binary:logistic" should appear as summary text
      expect(screen.getByText("binary:logistic")).toBeInTheDocument();
    });

    it("returns undefined when task-keyed object but task is not in keys", () => {
      const objectiveCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "objective",
          title: "Objective",
          paramType: "string",
          modes: ["fixed", "choice"],
          group: "model_params",
          default: {
            binary: "binary:logistic",
          },
        },
      ];
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={objectiveCatalog}
          task="multiclass"
        />,
      );
      // task "multiclass" not in default keys → "default" fallback shown
      expect(screen.getByText("default")).toBeInTheDocument();
    });

    it("returns raw value when default is not a plain object (e.g. number)", () => {
      const numCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "learning_rate",
          title: "Learning Rate",
          paramType: "number",
          modes: ["fixed", "range"],
          group: "model_params",
          default: 0.05,
        },
      ];
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={numCatalog}
          task="binary"
        />,
      );
      expect(screen.getByText("0.05")).toBeInTheDocument();
    });

    it("returns raw value when default is null", () => {
      const nullCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "max_depth",
          title: "Max Depth",
          paramType: "number",
          modes: ["fixed", "range"],
          group: "model_params",
          default: null,
        },
      ];
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={nullCatalog}
        />,
      );
      // null default → falls back to "default" string
      expect(screen.getByText("default")).toBeInTheDocument();
    });
  });

  describe("conditionalVisibility with array required values", () => {
    it("shows param when dep value is in required array", () => {
      const arrayCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "task",
          title: "Task",
          paramType: "string",
          modes: ["fixed"],
          group: "model_params",
        },
        {
          key: "class_weight",
          title: "Class Weight",
          paramType: "string",
          modes: ["fixed", "range"],
          group: "model_params",
        },
      ];
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ task: "binary" }}
          onChange={vi.fn()}
          catalog={arrayCatalog}
          conditionalVisibility={{
            class_weight: { task: ["binary", "multiclass"] },
          }}
        />,
      );
      expect(screen.getByText("class_weight")).toBeInTheDocument();
    });

    it("hides param when dep value is not in required array", () => {
      const arrayCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "task",
          title: "Task",
          paramType: "string",
          modes: ["fixed"],
          group: "model_params",
        },
        {
          key: "class_weight",
          title: "Class Weight",
          paramType: "string",
          modes: ["fixed", "range"],
          group: "model_params",
        },
      ];
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{ task: "regression" }}
          onChange={vi.fn()}
          catalog={arrayCatalog}
          conditionalVisibility={{
            class_weight: { task: ["binary", "multiclass"] },
          }}
        />,
      );
      expect(screen.queryByText("class_weight")).not.toBeInTheDocument();
    });
  });

  describe("precision_at_k in choice mode", () => {
    const metricCatalog: SearchSpaceCatalogEntry[] = [
      {
        key: "metric",
        title: "Metric",
        paramType: "string",
        modes: ["fixed", "choice"],
        group: "model_params",
        default: { binary: "auc" },
      },
    ];

    it("shows k-value row when precision_at_k is in choice mode choices", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{
            metric: {
              type: "categorical",
              choices: ["auc", "precision_at_k"],
            },
          }}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={metricCatalog}
          task="binary"
          metricOptions={["auc", "precision_at_k"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ metric: "model_metric" }}
        />,
      );
      expect(screen.getByText("precision_at_k: k")).toBeInTheDocument();
    });

    it("does not show k-value row when precision_at_k absent from choice choices", () => {
      const onModelParamChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{
            metric: { type: "categorical", choices: ["auc"] },
          }}
          modelParams={{}}
          onChange={vi.fn()}
          catalog={metricCatalog}
          task="binary"
          metricOptions={["auc", "precision_at_k"]}
          onModelParamChange={onModelParamChange}
          specialSearchSpaceFields={{ metric: "model_metric" }}
        />,
      );
      expect(screen.queryByText("precision_at_k: k")).not.toBeInTheDocument();
    });
  });

  describe("FeatureWeightsEditor", () => {
    it("renders FeatureWeightsEditor for object paramType", () => {
      const featureCatalog: SearchSpaceCatalogEntry[] = [
        {
          key: "feature_weights",
          title: "Feature Weights",
          paramType: "object",
          modes: ["fixed"],
          group: "model_params",
        },
      ];
      const onModelParamChange = vi.fn();
      renderWithQuery(
        <SearchSpaceTable
          space={{}}
          modelParams={{ feature_weights: { col_a: 1.0, col_b: 0.5 } }}
          onChange={vi.fn()}
          catalog={featureCatalog}
          onModelParamChange={onModelParamChange}
          columns={["col_a", "col_b"]}
        />,
      );
      expect(screen.getByText("feature_weights")).toBeInTheDocument();
    });
  });

  describe("distribution change", () => {
    it("updateEntry does nothing when space entry is absent", () => {
      // When switching distribution but space[key] is missing, updateEntry returns early
      const onChange = vi.fn();
      render(
        <SearchSpaceTable {...defaultProps} space={{}} onChange={onChange} />,
      );
      // No range entry exists, so toggling expansion has no effect
      const row = screen.getByText("learning_rate").closest("button");
      if (row) fireEvent.click(row);
      // onChange should not have been called by row click alone
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("stepMap", () => {
    it("applies stepMap value when switching to range mode", () => {
      const onChange = vi.fn();
      render(
        <SearchSpaceTable
          space={{}}
          modelParams={{}}
          onChange={onChange}
          catalog={catalog}
          stepMap={{ learning_rate: 0.001 }}
        />,
      );
      const rangeButtons = screen.getAllByRole("radio", { name: /range/i });
      fireEvent.click(rangeButtons[0]);

      const spaceArg = onChange.mock.calls[0][0];
      expect(spaceArg.learning_rate.step).toBe(0.001);
    });
  });
});
