import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompactStepper } from "./CompactStepper";

describe("CompactStepper", () => {
  it("renders with value displayed in input", () => {
    render(<CompactStepper value={42} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("42");
  });

  it("renders empty input when value is undefined", () => {
    render(<CompactStepper value={undefined} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("");
  });

  it("increment button increases value by step (default 1)", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={10} onChange={onChange} />);
    fireEvent.click(screen.getByText("+"));
    expect(onChange).toHaveBeenCalledWith(11);
  });

  it("decrement button decreases value by step (default 1)", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={10} onChange={onChange} />);
    fireEvent.click(screen.getByText("−"));
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it("increment uses custom step", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={10} onChange={onChange} step={5} />);
    fireEvent.click(screen.getByText("+"));
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it("decrement uses custom step", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={10} onChange={onChange} step={5} />);
    fireEvent.click(screen.getByText("−"));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("clamps increment to max", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={9} onChange={onChange} max={10} />);
    fireEvent.click(screen.getByText("+"));
    expect(onChange).toHaveBeenCalledWith(10);

    onChange.mockClear();
    render(<CompactStepper value={10} onChange={onChange} max={10} />);
    fireEvent.click(screen.getAllByText("+")[1]);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("clamps decrement to min", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={1} onChange={onChange} min={0} />);
    fireEvent.click(screen.getByText("−"));
    expect(onChange).toHaveBeenCalledWith(0);

    onChange.mockClear();
    render(<CompactStepper value={0} onChange={onChange} min={0} />);
    fireEvent.click(screen.getAllByText("−")[1]);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("handles direct text input and calls onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CompactStepper value={undefined} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "7");
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("empty input calls onChange with undefined", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={10} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("clamps value to min/max on blur", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={10} onChange={onChange} min={0} max={5} />);
    const input = screen.getByRole("textbox");
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("does not clamp when value is within range on blur", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={3} onChange={onChange} min={0} max={5} />);
    const input = screen.getByRole("textbox");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled state prevents button interaction", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={10} onChange={onChange} disabled />);
    const plusBtn = screen.getByText("+");
    const minusBtn = screen.getByText("−");
    expect(plusBtn).toBeDisabled();
    expect(minusBtn).toBeDisabled();
  });

  it("disabled state prevents input interaction", () => {
    render(<CompactStepper value={10} onChange={vi.fn()} disabled />);
    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
  });

  it("renders inside lzs-stepper container", () => {
    const { container } = render(
      <CompactStepper value={1} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".lzs-stepper")).toBeInTheDocument();
  });

  it("increment from undefined treats value as 0", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByText("+"));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("decrement from undefined treats value as 0", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByText("−"));
    expect(onChange).toHaveBeenCalledWith(-1);
  });

  it("ignores non-numeric text input (NaN guard)", () => {
    const onChange = vi.fn();
    render(<CompactStepper value={5} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows placeholder when no value", () => {
    render(
      <CompactStepper value={undefined} onChange={vi.fn()} placeholder="0" />,
    );
    expect(screen.getByPlaceholderText("0")).toBeInTheDocument();
  });
});
