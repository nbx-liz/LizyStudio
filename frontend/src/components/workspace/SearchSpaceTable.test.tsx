import { cleanup, render, screen } from "@testing-library/react";
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
});
