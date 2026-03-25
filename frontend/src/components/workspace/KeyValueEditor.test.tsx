import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyValueEditor } from "./KeyValueEditor";

describe("KeyValueEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it('renders "LightGBM params" label for modelName="lgbm"', () => {
    render(<KeyValueEditor params={{}} onChange={vi.fn()} modelName="lgbm" />);
    expect(screen.getByText("LightGBM params")).toBeInTheDocument();
  });

  it('renders "{modelName} params" label for other model names', () => {
    render(
      <KeyValueEditor params={{}} onChange={vi.fn()} modelName="xgboost" />,
    );
    expect(screen.getByText("xgboost params")).toBeInTheDocument();
  });

  it("with additionalParams: shows existing params from catalog", () => {
    render(
      <KeyValueEditor
        params={{ learning_rate: 0.1, max_depth: 6 }}
        onChange={vi.fn()}
        modelName="lgbm"
        additionalParams={["learning_rate", "max_depth", "n_estimators"]}
      />,
    );
    expect(screen.getByText("learning_rate")).toBeInTheDocument();
    expect(screen.getByText("max_depth")).toBeInTheDocument();
  });

  it('with additionalParams: shows "Add parameter..." select for unused params', () => {
    render(
      <KeyValueEditor
        params={{ learning_rate: 0.1 }}
        onChange={vi.fn()}
        modelName="lgbm"
        additionalParams={["learning_rate", "max_depth", "n_estimators"]}
      />,
    );
    expect(screen.getByText("Add parameter...")).toBeInTheDocument();
  });

  it('without additionalParams: shows "Add parameter" button for free-form rows', () => {
    render(<KeyValueEditor params={{}} onChange={vi.fn()} modelName="lgbm" />);
    expect(
      screen.getByRole("button", { name: /Add parameter/i }),
    ).toBeInTheDocument();
  });

  it('clicking "Add parameter" button adds a new row (free-form mode)', () => {
    render(<KeyValueEditor params={{}} onChange={vi.fn()} modelName="lgbm" />);

    // Initially no input rows
    expect(screen.queryByPlaceholderText("param name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Add parameter/i }));

    // After click, a row with key/value inputs appears
    expect(screen.getByPlaceholderText("param name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("value")).toBeInTheDocument();
  });
});
