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

  it("allows intermediate decimal input like '0.' without calling onChange with NaN", () => {
    const onChange = vi.fn();
    render(<NumberInput value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "0." } });
    // "0." parses as 0, which is a valid number — onChange IS called with 0
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("allows intermediate input '1.' without treating it as invalid", () => {
    const onChange = vi.fn();
    render(<NumberInput value={1} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1." } });
    // "1." parses as 1 — valid number, onChange called
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("handles leading dot '.5' as 0.5", () => {
    const onChange = vi.fn();
    render(<NumberInput value={undefined} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: ".5" } });
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("handles '-' as intermediate negative input (undefined)", () => {
    const onChange = vi.fn();
    render(<NumberInput value={undefined} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "-" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("blur with '.' clears input and calls onChange(undefined)", () => {
    const onChange = vi.fn();
    render(<NumberInput value={undefined} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "." } });
    onChange.mockClear();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(input).toHaveValue("");
  });

  it("blur with '-' clears input and calls onChange(undefined)", () => {
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "-" } });
    onChange.mockClear();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("blur with empty string calls onChange(undefined)", () => {
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    onChange.mockClear();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("blur with valid number clamps and calls onChange", () => {
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} min={0} max={10} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "15" } });
    onChange.mockClear();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("blur with invalid text restores previous value", () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberInput value={5} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    // Manually force raw to invalid text by directly firing with invalid text
    fireEvent.change(input, { target: { value: "abc" } });
    // onChange should NOT be called for invalid text
    onChange.mockClear();
    fireEvent.blur(input);
    // Should restore raw to the current value (5)
    expect(input).toHaveValue("5");
    rerender(<NumberInput value={5} onChange={onChange} />);
  });

  it("syncs raw when external value changes", () => {
    const { rerender } = render(<NumberInput value={10} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("10");
    rerender(<NumberInput value={20} onChange={vi.fn()} />);
    expect(input).toHaveValue("20");
  });

  it("does not overwrite raw when user mid-edit and parsed value matches external", () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberInput value={1} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    // User types "1." — raw is "1." but parsed value matches external (1)
    fireEvent.change(input, { target: { value: "1." } });
    // External value prop stays at 1
    rerender(<NumberInput value={1} onChange={onChange} />);
    // raw should remain "1." (not overwritten to "1")
    expect(input).toHaveValue("1.");
  });

  it("increment from undefined value starts at step", () => {
    const onChange = vi.fn();
    render(<NumberInput value={undefined} onChange={onChange} step={5} />);
    fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("decrement from undefined value starts at -step", () => {
    const onChange = vi.fn();
    render(<NumberInput value={undefined} onChange={onChange} step={5} />);
    fireEvent.click(screen.getByRole("button", { name: /decrement/i }));
    expect(onChange).toHaveBeenCalledWith(-5);
  });

  // P-0104 Wave 2.4 / Issue #460 — integer paramType usability guard.
  describe("paramType=integer", () => {
    it('advertises inputMode="numeric" to mobile keyboards', () => {
      render(<NumberInput value={10} onChange={vi.fn()} paramType="integer" />);
      const input = screen.getByRole("textbox");
      expect(input).toHaveAttribute("inputmode", "numeric");
    });

    it("typing an integer string still drives onChange", () => {
      const onChange = vi.fn();
      render(
        <NumberInput
          value={undefined}
          onChange={onChange}
          paramType="integer"
        />,
      );
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "42" } });
      expect(onChange).toHaveBeenCalledWith(42);
    });

    it("rejects decimal characters during typing and surfaces inline warning", () => {
      const onChange = vi.fn();
      render(<NumberInput value={1} onChange={onChange} paramType="integer" />);
      const input = screen.getByRole("textbox");
      onChange.mockClear();
      fireEvent.change(input, { target: { value: "1.5" } });
      // Raw text is preserved so the user can correct it
      expect(input).toHaveValue("1.5");
      // But onChange does NOT fire with the decimal value
      expect(onChange).not.toHaveBeenCalled();
      // Inline warning + aria-invalid are surfaced
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Integer values only",
      );
      expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("clears the violation when the user deletes the decimal point", () => {
      const onChange = vi.fn();
      render(<NumberInput value={1} onChange={onChange} paramType="integer" />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "1.5" } });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      onChange.mockClear();
      fireEvent.change(input, { target: { value: "15" } });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(input).not.toHaveAttribute("aria-invalid", "true");
      expect(onChange).toHaveBeenCalledWith(15);
    });

    it("blur on a decimal value rounds to nearest integer via Math.round", () => {
      const onChange = vi.fn();
      render(<NumberInput value={1} onChange={onChange} paramType="integer" />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "1.5" } });
      onChange.mockClear();
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith(2);
      expect(input).toHaveValue("2");
      // Violation cleared on blur
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("blur rounds 1.4 down to 1 (Math.round half-away-from-zero)", () => {
      const onChange = vi.fn();
      render(<NumberInput value={1} onChange={onChange} paramType="integer" />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "1.4" } });
      onChange.mockClear();
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith(1);
    });

    it("stepper buttons still work in integer mode", () => {
      const onChange = vi.fn();
      render(
        <NumberInput
          value={10}
          onChange={onChange}
          paramType="integer"
          step={1}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /increment/i }));
      expect(onChange).toHaveBeenCalledWith(11);
    });

    it("paramType=number preserves existing decimal-typing behaviour", () => {
      const onChange = vi.fn();
      render(<NumberInput value={0} onChange={onChange} paramType="number" />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "0.5" } });
      expect(onChange).toHaveBeenCalledWith(0.5);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("clamps integer value to min/max on blur", () => {
      const onChange = vi.fn();
      render(
        <NumberInput
          value={5}
          onChange={onChange}
          paramType="integer"
          min={0}
          max={10}
        />,
      );
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "20" } });
      onChange.mockClear();
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith(10);
    });
  });
});
