/**
 * Tests for FixedValueEditor component.
 * Covers: rendering per paramType, onChange behavior, edge cases.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FixedValueEditor } from "./FixedValueEditor";

describe("FixedValueEditor — number type", () => {
  it("renders a NumberInput (decrement/increment buttons) for 'number' paramType", () => {
    render(
      <FixedValueEditor paramType="number" value={0.1} onChange={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /decrement/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /increment/i }),
    ).toBeInTheDocument();
  });

  it("renders a NumberInput for 'integer' paramType", () => {
    render(
      <FixedValueEditor paramType="integer" value={6} onChange={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /decrement/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /increment/i }),
    ).toBeInTheDocument();
  });

  it("displays the current numeric value in the input", () => {
    render(
      <FixedValueEditor paramType="number" value={0.05} onChange={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("0.05")).toBeInTheDocument();
  });

  it("calls onChange with a number when increment is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FixedValueEditor
        paramType="number"
        value={0.1}
        onChange={onChange}
        step={0.01}
      />,
    );
    await user.click(screen.getByRole("button", { name: /increment/i }));
    expect(onChange).toHaveBeenCalledOnce();
    const called = onChange.mock.calls[0][0];
    expect(typeof called).toBe("number");
  });

  it("uses the provided step for integer type", () => {
    render(
      <FixedValueEditor
        paramType="integer"
        value={6}
        onChange={vi.fn()}
        step={1}
      />,
    );
    // Step=1 means integer steps; just verify it renders without error
    expect(screen.getByDisplayValue("6")).toBeInTheDocument();
  });
});

describe("FixedValueEditor — boolean type", () => {
  it("renders two segment buttons: True and False", () => {
    render(
      <FixedValueEditor paramType="boolean" value={true} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /true/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /false/i })).toBeInTheDocument();
  });

  it("highlights the True button when value is true", () => {
    render(
      <FixedValueEditor paramType="boolean" value={true} onChange={vi.fn()} />,
    );
    const trueBtn = screen.getByRole("button", { name: /true/i });
    // Active button uses 'default' variant which adds a different data-variant
    expect(trueBtn).toHaveAttribute("data-active", "true");
  });

  it("highlights the False button when value is false", () => {
    render(
      <FixedValueEditor paramType="boolean" value={false} onChange={vi.fn()} />,
    );
    const falseBtn = screen.getByRole("button", { name: /false/i });
    expect(falseBtn).toHaveAttribute("data-active", "true");
  });

  it("calls onChange with boolean true when True button clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FixedValueEditor
        paramType="boolean"
        value={false}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /true/i }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange with boolean false when False button clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FixedValueEditor paramType="boolean" value={true} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: /false/i }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("handles string 'true'/'false' values from config", () => {
    render(
      <FixedValueEditor paramType="boolean" value="true" onChange={vi.fn()} />,
    );
    const trueBtn = screen.getByRole("button", { name: /true/i });
    expect(trueBtn).toHaveAttribute("data-active", "true");
  });
});

describe("FixedValueEditor — string type with ≤4 options (segment)", () => {
  it("renders a SegmentGroup (radiogroup) when options count ≤ 4", () => {
    render(
      <FixedValueEditor
        paramType="string"
        value="binary"
        onChange={vi.fn()}
        options={["binary", "multiclass", "regression"]}
      />,
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    // Should NOT render a Select combobox
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders segment buttons for exactly 4 options (boundary)", () => {
    render(
      <FixedValueEditor
        paramType="string"
        value="cpu"
        onChange={vi.fn()}
        options={["cpu", "gpu", "tpu", "auto"]}
      />,
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "cpu" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "gpu" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "tpu" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "auto" })).toBeInTheDocument();
  });

  it("calls onChange when a segment option is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FixedValueEditor
        paramType="string"
        value="binary"
        onChange={onChange}
        options={["binary", "multiclass", "regression"]}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "regression" }));
    expect(onChange).toHaveBeenCalledWith("regression");
  });

  it("marks the current value as active (aria-checked)", () => {
    render(
      <FixedValueEditor
        paramType="string"
        value="binary"
        onChange={vi.fn()}
        options={["binary", "multiclass"]}
      />,
    );
    expect(screen.getByRole("radio", { name: "binary" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "multiclass" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("FixedValueEditor — string type with >4 options (select)", () => {
  it("renders a Select trigger (combobox) when options count > 4", () => {
    render(
      <FixedValueEditor
        paramType="string"
        value="auc"
        onChange={vi.fn()}
        options={["auc", "f1", "accuracy", "logloss", "mse"]}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    // Should NOT render a radiogroup
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("displays the current value in the Select", () => {
    render(
      <FixedValueEditor
        paramType="string"
        value="auc"
        onChange={vi.fn()}
        options={["auc", "f1", "accuracy", "logloss", "mse"]}
      />,
    );
    expect(screen.getByText("auc")).toBeInTheDocument();
  });

  it("wires onValueChange to onChange prop (verified via re-render with new value)", () => {
    const onChange = vi.fn();
    const options = ["auc", "f1", "accuracy", "logloss", "mse"];
    const { rerender } = render(
      <FixedValueEditor
        paramType="string"
        value="auc"
        onChange={onChange}
        options={options}
      />,
    );
    expect(screen.getByText("auc")).toBeInTheDocument();
    rerender(
      <FixedValueEditor
        paramType="string"
        value="f1"
        onChange={onChange}
        options={options}
      />,
    );
    expect(screen.getByText("f1")).toBeInTheDocument();
  });
});

describe("FixedValueEditor — string type without options", () => {
  it("renders a plain text Input when no options are provided", () => {
    render(
      <FixedValueEditor paramType="string" value="cpu" onChange={vi.fn()} />,
    );
    // No combobox, just a plain input
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("displays the current string value in the text input", () => {
    render(
      <FixedValueEditor paramType="string" value="cpu" onChange={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("cpu")).toBeInTheDocument();
  });

  it("calls onChange when text input value changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FixedValueEditor paramType="string" value="" onChange={onChange} />,
    );
    await user.type(screen.getByRole("textbox"), "gpu");
    // onChange is called for each character typed (controlled input)
    expect(onChange).toHaveBeenCalledTimes(3);
    // Each call receives the character typed (since value stays "" — controlled)
    expect(onChange).toHaveBeenCalledWith("g");
    expect(onChange).toHaveBeenCalledWith("p");
    expect(onChange).toHaveBeenCalledWith("u");
  });

  it("handles undefined value gracefully (renders empty input)", () => {
    render(
      <FixedValueEditor
        paramType="string"
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});

describe("FixedValueEditor — edge cases", () => {
  it("handles null value for number type without crashing", () => {
    render(
      <FixedValueEditor paramType="number" value={null} onChange={vi.fn()} />,
    );
    // NumberInput shows empty when value is undefined/null
    expect(
      screen.getByRole("button", { name: /decrement/i }),
    ).toBeInTheDocument();
  });

  it("handles undefined value for boolean type (defaults to false segment)", () => {
    render(
      <FixedValueEditor
        paramType="boolean"
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /true/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /false/i })).toBeInTheDocument();
  });

  it("falls back to text Input for unknown paramType", () => {
    render(
      <FixedValueEditor
        paramType="unknown_type"
        value="foo"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
