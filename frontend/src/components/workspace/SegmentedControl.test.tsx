import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

const PRESETS = [
  { label: "10", value: 10 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

describe("SegmentedControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all preset options", () => {
    render(
      <SegmentedControl presets={PRESETS} value={10} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "50" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "100" })).toBeInTheDocument();
  });

  it("selected option has default variant (not outline)", () => {
    render(
      <SegmentedControl presets={PRESETS} value={50} onChange={vi.fn()} />,
    );
    const selectedBtn = screen.getByRole("button", { name: "50" });
    // shadcn default variant applies bg-primary
    expect(selectedBtn).toHaveClass("bg-primary");
  });

  it("non-selected options do not have default variant", () => {
    render(
      <SegmentedControl presets={PRESETS} value={50} onChange={vi.fn()} />,
    );
    const notSelectedBtn = screen.getByRole("button", { name: "10" });
    expect(notSelectedBtn).not.toHaveClass("bg-primary");
  });

  it("clicking a preset button calls onChange with correct value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl presets={PRESETS} value={10} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "100" }));
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("clicking an already selected preset still calls onChange", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl presets={PRESETS} value={10} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "10" }));
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("does not render Custom button when allowCustom is false", () => {
    render(
      <SegmentedControl presets={PRESETS} value={10} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /custom/i })).toBeNull();
  });

  it("renders Custom button when allowCustom is true", () => {
    render(
      <SegmentedControl
        presets={PRESETS}
        value={10}
        onChange={vi.fn()}
        allowCustom
      />,
    );
    expect(screen.getByRole("button", { name: /custom/i })).toBeInTheDocument();
  });

  it("supports preset with null value (e.g. None)", () => {
    const presetsWithNull = [
      { label: "None", value: null },
      { label: "5m", value: 300 },
    ];
    const onChange = vi.fn();
    render(
      <SegmentedControl
        presets={presetsWithNull}
        value={null}
        onChange={onChange}
      />,
    );
    const noneBtn = screen.getByRole("button", { name: "None" });
    expect(noneBtn).toHaveClass("bg-primary");
    fireEvent.click(screen.getByRole("button", { name: "5m" }));
    expect(onChange).toHaveBeenCalledWith(300);
  });
});
