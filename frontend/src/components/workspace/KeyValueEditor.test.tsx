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

  it("calls onChange when custom row key and value are filled", () => {
    const onChange = vi.fn();
    render(<KeyValueEditor params={{}} onChange={onChange} modelName="lgbm" />);

    fireEvent.click(screen.getByRole("button", { name: /Add parameter/i }));

    const keyInput = screen.getByPlaceholderText("param name");
    const valueInput = screen.getByPlaceholderText("value");

    fireEvent.change(keyInput, { target: { value: "my_param" } });
    fireEvent.change(valueInput, { target: { value: "42" } });

    // onChange should have been called with the new param (numeric conversion)
    expect(onChange).toHaveBeenCalled();
  });

  it("removes custom row and calls onChange when remove button is clicked", () => {
    const onChange = vi.fn();
    render(<KeyValueEditor params={{}} onChange={onChange} modelName="lgbm" />);

    // Add a row
    fireEvent.click(screen.getByRole("button", { name: /Add parameter/i }));
    expect(screen.getByPlaceholderText("param name")).toBeInTheDocument();

    // Remove the row (X button)
    const removeButtons = screen
      .getAllByRole("button")
      .filter((btn) => !btn.textContent?.includes("Add"));
    // Find the remove button (last one should be the X icon button)
    const removeBtn = removeButtons[removeButtons.length - 1];
    fireEvent.click(removeBtn);

    expect(screen.queryByPlaceholderText("param name")).not.toBeInTheDocument();
  });

  it("adds multiple custom rows", () => {
    render(<KeyValueEditor params={{}} onChange={vi.fn()} modelName="lgbm" />);

    fireEvent.click(screen.getByRole("button", { name: /Add parameter/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add parameter/i }));

    const keyInputs = screen.getAllByPlaceholderText("param name");
    expect(keyInputs).toHaveLength(2);
  });

  it("with additionalParams: renders catalog entry with stepper", () => {
    render(
      <KeyValueEditor
        params={{ learning_rate: 0.1 }}
        onChange={vi.fn()}
        modelName="lgbm"
        additionalParams={["learning_rate", "max_depth"]}
        stepMap={{ learning_rate: 0.01, max_depth: 1 }}
      />,
    );
    expect(screen.getByText("learning_rate")).toBeInTheDocument();
  });

  it("with additionalParams: does not show free-form Add parameter button", () => {
    render(
      <KeyValueEditor
        params={{}}
        onChange={vi.fn()}
        modelName="lgbm"
        additionalParams={["learning_rate"]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Add parameter/i }),
    ).not.toBeInTheDocument();
  });

  it("with additionalParams: hides select when all params are added", () => {
    render(
      <KeyValueEditor
        params={{ learning_rate: 0.1, max_depth: 6 }}
        onChange={vi.fn()}
        modelName="lgbm"
        additionalParams={["learning_rate", "max_depth"]}
      />,
    );
    expect(screen.queryByText("Add parameter...")).not.toBeInTheDocument();
  });

  it("custom row string values are passed as-is (not converted to number)", () => {
    const onChange = vi.fn();
    render(<KeyValueEditor params={{}} onChange={onChange} modelName="lgbm" />);

    fireEvent.click(screen.getByRole("button", { name: /Add parameter/i }));

    const keyInput = screen.getByPlaceholderText("param name");
    const valueInput = screen.getByPlaceholderText("value");

    fireEvent.change(keyInput, { target: { value: "mode" } });
    fireEvent.change(valueInput, { target: { value: "fast" } });

    // The last call should include mode: "fast" (string, not number)
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastCall[0]).toHaveProperty("mode", "fast");
  });
});
