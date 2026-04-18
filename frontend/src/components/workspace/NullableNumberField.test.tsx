import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NullableNumberField } from "./NullableNumberField";

describe("NullableNumberField", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the label", () => {
    render(
      <NullableNumberField
        label="Timeout"
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Timeout")).toBeInTheDocument();
  });

  it("renders the value in the input when set", () => {
    render(
      <NullableNumberField label="Budget" value={30} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("30");
  });

  it("renders an empty input when value is undefined", () => {
    render(
      <NullableNumberField
        label="Budget"
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("uses the custom placeholder when provided", () => {
    render(
      <NullableNumberField
        label="Budget"
        value={undefined}
        onChange={vi.fn()}
        placeholder="Unlimited"
      />,
    );
    expect(screen.getByPlaceholderText("Unlimited")).toBeInTheDocument();
  });

  it("falls back to the 'Auto' placeholder when no explicit value is given", () => {
    render(
      <NullableNumberField
        label="Budget"
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Auto")).toBeInTheDocument();
  });

  it("shows the auto hint suffix when autoHint=true", () => {
    render(
      <NullableNumberField
        label="Timeout"
        value={undefined}
        onChange={vi.fn()}
        autoHint
      />,
    );
    expect(screen.getByText("(empty = auto)")).toBeInTheDocument();
  });

  it("omits the auto hint suffix by default", () => {
    render(
      <NullableNumberField
        label="Timeout"
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("(empty = auto)")).not.toBeInTheDocument();
  });

  it("forwards min=1 to the NumberInput when autoHint=true (ensures 0 is clamped)", () => {
    const onChange = vi.fn();
    render(
      <NullableNumberField
        label="Trials"
        value={1}
        onChange={onChange}
        autoHint
      />,
    );
    // Decrement below 1 should clamp to 1 because autoHint sets min=1.
    fireEvent.click(screen.getByRole("button", { name: /decrement/i }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("forwards min=0 to the NumberInput when autoHint is not set", () => {
    const onChange = vi.fn();
    render(
      <NullableNumberField label="Offset" value={0} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /decrement/i }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("propagates onChange when the user types a value", () => {
    const onChange = vi.fn();
    render(
      <NullableNumberField
        label="Budget"
        value={undefined}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("propagates onChange(undefined) when the user clears the input", () => {
    const onChange = vi.fn();
    render(
      <NullableNumberField label="Budget" value={10} onChange={onChange} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
