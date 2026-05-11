import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/helpers";
import { SearchSpaceRow } from "./SearchSpaceRow";
import type { SearchSpaceRowProps } from "./search-space-utils";

// ---------------------------------------------------------------------------
// Shared defaults
// ---------------------------------------------------------------------------

const baseParam: SearchSpaceRowProps["param"] = {
  key: "learning_rate",
  type: "float",
  catalogDefault: 0.01,
  description: "Learning rate",
  modes: ["fixed", "range"],
  paramType: "number",
  group: "model_params",
  defaultRange: { low: 0.001, high: 0.1, log: false },
};

const baseCallbacks = {
  onToggleExpand: vi.fn(),
  onModeChange: vi.fn(),
  onUpdateEntry: vi.fn(),
  onDistributionChange: vi.fn(),
  getChoiceOptions: vi.fn().mockReturnValue(undefined),
};

function makeProps(
  overrides: Partial<SearchSpaceRowProps> = {},
): SearchSpaceRowProps {
  return {
    param: baseParam,
    space: {},
    modelParams: {},
    isExpanded: false,
    ...baseCallbacks,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – basic", () => {
  it("renders param key", () => {
    renderWithQuery(<SearchSpaceRow {...makeProps()} />);
    expect(screen.getByText("learning_rate")).toBeInTheDocument();
  });

  it("shows no chevron when mode is fixed (not expandable)", () => {
    const { container } = renderWithQuery(<SearchSpaceRow {...makeProps()} />);
    // fixed mode → no SVG chevron
    const chevrons = container.querySelectorAll("svg");
    expect(chevrons).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fixed mode – fallback string (line 166-170: no onModelParamChange)
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – fixed mode without onModelParamChange", () => {
  it("displays catalogDefault string when modelParams has no value", () => {
    renderWithQuery(
      <SearchSpaceRow {...makeProps({ modelParams: {}, task: "binary" })} />,
    );
    // resolveCatalogDefault(0.01, "binary") → 0.01 → string "0.01"
    expect(screen.getByText("0.01")).toBeInTheDocument();
  });

  it("displays modelParams value when present", () => {
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({ modelParams: { learning_rate: 0.05 } })}
      />,
    );
    expect(screen.getByText("0.05")).toBeInTheDocument();
  });

  it("shows 'default' when no modelParam and no catalogDefault", () => {
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, catalogDefault: undefined },
          modelParams: {},
        })}
      />,
    );
    expect(screen.getByText("default")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Fixed mode – FixedValueEditor (onModelParamChange present, line 154-164)
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – FixedValueEditor", () => {
  it("renders FixedValueEditor input when onModelParamChange is provided", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          modelParams: { learning_rate: 0.01 },
          onModelParamChange,
        })}
      />,
    );
    // NumberInput renders type="text" with inputMode="decimal" → role textbox
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("0.01");
  });

  it("calls onModelParamChange when FixedValueEditor value changes", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          modelParams: { learning_rate: 0.01 },
          onModelParamChange,
        })}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "0.05" } });
    expect(onModelParamChange).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// FeatureWeightsEditor (line 146-153: paramType === "object")
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – FeatureWeightsEditor (paramType=object)", () => {
  it("renders FeatureWeightsEditor when paramType is object", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: {
            ...baseParam,
            key: "feature_weights",
            paramType: "object",
          },
          modelParams: { feature_weights: { col_a: 1.0, col_b: 2.0 } },
          columns: ["col_a", "col_b"],
          onModelParamChange,
        })}
      />,
    );
    // FeatureWeightsEditor renders column names
    expect(screen.getByText("col_a")).toBeInTheDocument();
    expect(screen.getByText("col_b")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Objective SegmentGroup (line 104-113: specialSearchSpaceFields === "objective")
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – objective SegmentGroup", () => {
  it("renders SegmentGroup for objective field", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "objective" },
          modelParams: { objective: "binary" },
          onModelParamChange,
          specialSearchSpaceFields: { objective: "objective" },
          objectiveOptions: ["binary", "multiclass", "regression"],
          task: "binary",
        })}
      />,
    );
    expect(screen.getByText("binary")).toBeInTheDocument();
    expect(screen.getByText("multiclass")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// model_metric chip buttons (lines 115-145)
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – model_metric chips", () => {
  it("renders metric chips", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "metrics" },
          modelParams: { metrics: ["auc"] },
          onModelParamChange,
          specialSearchSpaceFields: { metrics: "model_metric" },
          metricOptions: ["auc", "logloss", "accuracy"],
        })}
      />,
    );
    expect(screen.getByText("auc")).toBeInTheDocument();
    expect(screen.getByText("logloss")).toBeInTheDocument();
    expect(screen.getByText("accuracy")).toBeInTheDocument();
  });

  it("toggles metric on click – adds when not selected", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "metrics" },
          modelParams: { metrics: [] },
          onModelParamChange,
          specialSearchSpaceFields: { metrics: "model_metric" },
          metricOptions: ["auc", "logloss"],
        })}
      />,
    );
    fireEvent.click(screen.getByText("auc"));
    expect(onModelParamChange).toHaveBeenCalledWith("metrics", ["auc"]);
  });

  it("toggles metric on click – removes when selected", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "metrics" },
          modelParams: { metrics: ["auc", "logloss"] },
          onModelParamChange,
          specialSearchSpaceFields: { metrics: "model_metric" },
          metricOptions: ["auc", "logloss"],
        })}
      />,
    );
    fireEvent.click(screen.getByText("auc"));
    expect(onModelParamChange).toHaveBeenCalledWith("metrics", ["logloss"]);
  });
});

// ---------------------------------------------------------------------------
// Range mode – expanded panel (lines 176-222)
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – range mode expanded", () => {
  const rangeSpace = {
    learning_rate: { type: "float", low: 0.001, high: 0.1, log: false },
  };

  it("shows chevron when range mode", () => {
    const { container } = renderWithQuery(
      <SearchSpaceRow {...makeProps({ space: rangeSpace })} />,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("shows range summary in collapsed state", () => {
    renderWithQuery(<SearchSpaceRow {...makeProps({ space: rangeSpace })} />);
    expect(screen.getByText("0.001 ~ 0.1")).toBeInTheDocument();
  });

  it("expands to show Min/Max/Distribution labels", () => {
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({ space: rangeSpace, isExpanded: true })}
      />,
    );
    expect(screen.getByText("Min")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByText("Distribution")).toBeInTheDocument();
  });

  it("calls onUpdateEntry when Min value changes", () => {
    const onUpdateEntry = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({ space: rangeSpace, isExpanded: true, onUpdateEntry })}
      />,
    );
    // NumberInput uses type="text" → role textbox; Min input has value "0.001"
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "0.002" } });
    expect(onUpdateEntry).toHaveBeenCalledWith(
      "learning_rate",
      expect.objectContaining({ low: 0.002 }),
    );
  });

  it("calls onUpdateEntry when Max value changes", () => {
    const onUpdateEntry = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({ space: rangeSpace, isExpanded: true, onUpdateEntry })}
      />,
    );
    const inputs = screen.getAllByRole("textbox");
    // Second textbox is the Max input (value "0.1")
    fireEvent.change(inputs[1], { target: { value: "0.5" } });
    expect(onUpdateEntry).toHaveBeenCalledWith(
      "learning_rate",
      expect.objectContaining({ high: 0.5 }),
    );
  });

  it("shows Step input for integer type", () => {
    const intSpace = {
      n_estimators: { type: "int", low: 10, high: 500, log: false },
    };
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "n_estimators", type: "integer" },
          space: intSpace,
          isExpanded: true,
        })}
      />,
    );
    expect(screen.getByText("Step")).toBeInTheDocument();
  });

  // P-0104 Wave 2.4 / Issue #460 — integer paramType on Range Min/Max
  // surfaces an inline warning when the user attempts a decimal value
  // and does NOT propagate the decimal upward via onUpdateEntry.
  it("Range Min for integer paramType rejects decimals and shows inline warning", () => {
    const intSpace = {
      n_estimators: { type: "int", low: 10, high: 500, log: false },
    };
    const onUpdateEntry = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "n_estimators", type: "integer" },
          space: intSpace,
          isExpanded: true,
          onUpdateEntry,
        })}
      />,
    );
    const minInput = screen.getByRole("textbox", { name: /n_estimators min/i });
    fireEvent.change(minInput, { target: { value: "10.5" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Integer values only");
    expect(onUpdateEntry).not.toHaveBeenCalled();
  });

  it("Range Max for integer paramType rounds to int on blur", () => {
    const intSpace = {
      n_estimators: { type: "int", low: 10, high: 500, log: false },
    };
    const onUpdateEntry = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "n_estimators", type: "integer" },
          space: intSpace,
          isExpanded: true,
          onUpdateEntry,
        })}
      />,
    );
    const maxInput = screen.getByRole("textbox", { name: /n_estimators max/i });
    fireEvent.change(maxInput, { target: { value: "500.6" } });
    onUpdateEntry.mockClear();
    fireEvent.blur(maxInput);
    expect(onUpdateEntry).toHaveBeenCalledWith(
      "n_estimators",
      expect.objectContaining({ high: 501 }),
    );
  });

  it("Range Min for float paramType keeps decimal-typing behaviour", () => {
    const onUpdateEntry = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({ space: rangeSpace, isExpanded: true, onUpdateEntry })}
      />,
    );
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "0.0001" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onUpdateEntry).toHaveBeenCalledWith(
      "learning_rate",
      expect.objectContaining({ low: 0.0001 }),
    );
  });

  it("calls onToggleExpand when summary button clicked in range mode", () => {
    const onToggleExpand = vi.fn();
    renderWithQuery(
      <SearchSpaceRow {...makeProps({ space: rangeSpace, onToggleExpand })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /learning_rate/i }));
    expect(onToggleExpand).toHaveBeenCalledWith("learning_rate");
  });
});

// ---------------------------------------------------------------------------
// Choice mode – expanded panel (lines 226-234)
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – choice mode expanded", () => {
  const choiceSpace = {
    booster: { type: "categorical", choices: ["gbdt", "dart"] },
  };
  const choiceParam: SearchSpaceRowProps["param"] = {
    ...baseParam,
    key: "booster",
    type: "float",
    modes: ["fixed", "range", "choice"],
  };

  it("shows choices summary in collapsed state", () => {
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({ param: choiceParam, space: choiceSpace })}
      />,
    );
    expect(screen.getByText("gbdt, dart")).toBeInTheDocument();
  });

  it("renders ChoiceInput when expanded", () => {
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: choiceParam,
          space: choiceSpace,
          isExpanded: true,
          getChoiceOptions: vi.fn().mockReturnValue(["gbdt", "dart", "goss"]),
        })}
      />,
    );
    // ChoiceInput renders existing choices as tags or checkboxes
    expect(screen.getByText("gbdt")).toBeInTheDocument();
    expect(screen.getByText("dart")).toBeInTheDocument();
  });

  it("calls onUpdateEntry when a ChoiceInput option badge is toggled (add)", () => {
    const onUpdateEntry = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: choiceParam,
          space: choiceSpace,
          isExpanded: true,
          onUpdateEntry,
          getChoiceOptions: vi.fn().mockReturnValue(["gbdt", "dart", "goss"]),
        })}
      />,
    );
    // "goss" is not yet selected — clicking should add it
    fireEvent.click(screen.getByRole("button", { name: "goss" }));
    expect(onUpdateEntry).toHaveBeenCalledWith(
      "booster",
      expect.objectContaining({
        choices: expect.arrayContaining(["gbdt", "dart", "goss"]),
      }),
    );
  });

  it("calls onUpdateEntry when a ChoiceInput option badge is toggled (remove)", () => {
    const onUpdateEntry = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: choiceParam,
          space: choiceSpace,
          isExpanded: true,
          onUpdateEntry,
          getChoiceOptions: vi.fn().mockReturnValue(["gbdt", "dart", "goss"]),
        })}
      />,
    );
    // "gbdt" is already selected — clicking should remove it
    fireEvent.click(screen.getByRole("button", { name: "gbdt" }));
    expect(onUpdateEntry).toHaveBeenCalledWith(
      "booster",
      expect.objectContaining({ choices: ["dart"] }),
    );
  });
});

// ---------------------------------------------------------------------------
// precision_at_k row (lines 237-268)
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – precision_at_k row", () => {
  it("shows precision_at_k k input when fixed metric includes precision_at_k", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "metrics" },
          modelParams: { metrics: ["precision_at_k"], _precision_at_k_k: 5 },
          onModelParamChange,
          specialSearchSpaceFields: { metrics: "model_metric" },
          metricOptions: ["precision_at_k", "auc"],
        })}
      />,
    );
    expect(screen.getByText(/precision_at_k: k/)).toBeInTheDocument();
    // NumberInput renders type="text" → role textbox; value is the k number as string
    const kInput = screen.getByRole("textbox");
    expect(kInput).toHaveValue("5");
  });

  it("defaults k to 10 when _precision_at_k_k is absent", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "metrics" },
          modelParams: { metrics: ["precision_at_k"] },
          onModelParamChange,
          specialSearchSpaceFields: { metrics: "model_metric" },
          metricOptions: ["precision_at_k"],
        })}
      />,
    );
    const kInput = screen.getByRole("textbox");
    expect(kInput).toHaveValue("10");
  });

  it("does not show k row when precision_at_k is not selected", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "metrics" },
          modelParams: { metrics: ["auc"] },
          onModelParamChange,
          specialSearchSpaceFields: { metrics: "model_metric" },
          metricOptions: ["precision_at_k", "auc"],
        })}
      />,
    );
    expect(screen.queryByText(/precision_at_k: k/)).not.toBeInTheDocument();
  });

  it("calls onModelParamChange with _precision_at_k_k when k input changes", () => {
    const onModelParamChange = vi.fn();
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: { ...baseParam, key: "metrics" },
          modelParams: { metrics: ["precision_at_k"], _precision_at_k_k: 10 },
          onModelParamChange,
          specialSearchSpaceFields: { metrics: "model_metric" },
          metricOptions: ["precision_at_k"],
        })}
      />,
    );
    const kInput = screen.getByRole("textbox");
    fireEvent.change(kInput, { target: { value: "20" } });
    expect(onModelParamChange).toHaveBeenCalledWith("_precision_at_k_k", 20);
  });

  it("shows precision_at_k k row in choice mode when choices include it", () => {
    const onModelParamChange = vi.fn();
    const choiceSpace = {
      metrics: { type: "categorical", choices: ["precision_at_k", "auc"] },
    };
    renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          param: {
            ...baseParam,
            key: "metrics",
            modes: ["fixed", "range", "choice"],
          },
          space: choiceSpace,
          modelParams: { _precision_at_k_k: 3 },
          onModelParamChange,
          specialSearchSpaceFields: { metrics: "model_metric" },
          metricOptions: ["precision_at_k", "auc"],
        })}
      />,
    );
    expect(screen.getByText(/precision_at_k: k/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// HTML structural validity (no nested buttons — see #274)
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – HTML validity", () => {
  it("does not render a real <button> as the row wrapper", () => {
    // The row wrapper must not be a <button> element because it contains
    // interactive descendants (SegmentGroup radio buttons, stepper icon
    // buttons), which would violate the HTML5 content model and trigger
    // React hydration warnings (#274).
    const { container } = renderWithQuery(<SearchSpaceRow {...makeProps()} />);
    const wrapper = container.querySelector('[role="button"]');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.tagName).toBe("DIV");
  });

  it("does not nest any <button> inside another <button>", () => {
    // When rendered in range mode (expandable) with onModelParamChange
    // present, the row contains both SegmentGroup radio buttons and stepper
    // icon buttons. Walk every <button> and assert none of them has a
    // <button> ancestor inside the same row.
    const onModelParamChange = vi.fn();
    const { container } = renderWithQuery(
      <SearchSpaceRow
        {...makeProps({
          space: {
            learning_rate: { type: "float", low: 0.001, high: 0.1, log: false },
          },
          modelParams: { learning_rate: 0.01 },
          onModelParamChange,
        })}
      />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of Array.from(buttons)) {
      const ancestorButton = btn.parentElement?.closest("button");
      expect(ancestorButton).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Keyboard event stopPropagation (lines 77, 97)
// ---------------------------------------------------------------------------

describe("SearchSpaceRow – keyboard stopPropagation on wrappers", () => {
  it("fires onKeyDown on mode wrapper div without error", () => {
    const { container } = renderWithQuery(<SearchSpaceRow {...makeProps()} />);
    // The mode wrapper div is the first w-32 div inside the button
    const modeWrapper = container.querySelector(".w-32");
    expect(modeWrapper).toBeTruthy();
    // Should not throw
    fireEvent.keyDown(modeWrapper as Element, { key: "Enter" });
  });

  it("fires onKeyDown on summary span without error", () => {
    renderWithQuery(<SearchSpaceRow {...makeProps()} />);
    // The summary/fixed-editor span holds the value text
    const summaryEl = screen.getByText("0.01").closest("span");
    expect(summaryEl).toBeTruthy();
    fireEvent.keyDown(summaryEl as Element, { key: "Space" });
  });
});
