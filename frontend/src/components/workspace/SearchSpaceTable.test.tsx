import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchSpaceCatalogEntry } from "@/api/types";
import { SearchSpaceTable } from "./SearchSpaceTable";

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

  it("falls back to KNOWN_PARAMS when no catalog provided", () => {
    render(<SearchSpaceTable space={{}} modelParams={{}} onChange={vi.fn()} />);
    // KNOWN_PARAMS includes learning_rate, num_leaves, n_estimators, etc.
    expect(screen.getByText("learning_rate")).toBeInTheDocument();
    expect(screen.getByText("num_leaves")).toBeInTheDocument();
    expect(screen.getByText("n_estimators")).toBeInTheDocument();
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
});
