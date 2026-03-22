import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentGroup } from "./SegmentGroup";

const OPTIONS = ["small", "medium", "large"];

describe("SegmentGroup", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all options as radio buttons", () => {
    render(<SegmentGroup options={OPTIONS} value="small" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "small" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "medium" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "large" })).toBeInTheDocument();
  });

  it("active radio has aria-checked=true", () => {
    render(
      <SegmentGroup options={OPTIONS} value="medium" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("radio", { name: "medium" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("inactive radios have aria-checked=false", () => {
    render(
      <SegmentGroup options={OPTIONS} value="medium" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("radio", { name: "small" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: "large" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("active button has active CSS class", () => {
    render(<SegmentGroup options={OPTIONS} value="large" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "large" })).toHaveClass(
      "lzs-segment__btn--active",
    );
  });

  it("inactive buttons do not have active CSS class", () => {
    render(<SegmentGroup options={OPTIONS} value="large" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "small" })).not.toHaveClass(
      "lzs-segment__btn--active",
    );
  });

  it("calls onChange when clicking a different option", () => {
    const onChange = vi.fn();
    render(
      <SegmentGroup options={OPTIONS} value="small" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "large" }));
    expect(onChange).toHaveBeenCalledWith("large");
  });

  it("does not call onChange when clicking the active option", () => {
    const onChange = vi.fn();
    render(
      <SegmentGroup options={OPTIONS} value="small" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "small" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses labels map for display text", () => {
    const labels = { small: "S", medium: "M", large: "L" };
    render(
      <SegmentGroup
        options={OPTIONS}
        value="small"
        onChange={vi.fn()}
        labels={labels}
      />,
    );
    expect(screen.getByRole("radio", { name: "S" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "M" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "L" })).toBeInTheDocument();
  });

  it("disabled buttons cannot be clicked", () => {
    const onChange = vi.fn();
    render(
      <SegmentGroup
        options={OPTIONS}
        value="small"
        onChange={onChange}
        disabled
      />,
    );
    const btn = screen.getByRole("radio", { name: "large" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wraps buttons in .lzs-segment container", () => {
    const { container } = render(
      <SegmentGroup options={OPTIONS} value="small" onChange={vi.fn()} />,
    );
    expect(container.querySelector(".lzs-segment")).toBeInTheDocument();
  });
});
