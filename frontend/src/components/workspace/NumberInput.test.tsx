import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberInput } from "./NumberInput";

describe("NumberInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with value", () => {
    render(<NumberInput value={42} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("42");
  });

  it("renders with undefined value", () => {
    render(<NumberInput value={undefined} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("");
  });

  it("calls onChange on increment", () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} step={1} />);
    fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    expect(onChange).toHaveBeenCalledWith(11);
  });

  it("calls onChange on decrement", () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} step={1} />);
    fireEvent.click(screen.getByRole("button", { name: /decrement/i }));
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it("clamps value to min", () => {
    const onChange = vi.fn();
    render(<NumberInput value={0} onChange={onChange} step={1} min={0} />);
    fireEvent.click(screen.getByRole("button", { name: /decrement/i }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("clamps value to max", () => {
    const onChange = vi.fn();
    render(<NumberInput value={100} onChange={onChange} step={1} max={100} />);
    fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("handles empty input", () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
