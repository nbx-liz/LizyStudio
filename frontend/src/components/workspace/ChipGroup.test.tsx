import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChipGroup } from "./ChipGroup";

describe("ChipGroup", () => {
  it("renders all options as buttons", () => {
    render(
      <ChipGroup options={["a", "b", "c"]} selected={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "c" })).toBeInTheDocument();
  });

  it("applies lzs-chip--active class to selected items only", () => {
    render(
      <ChipGroup
        options={["a", "b", "c"]}
        selected={["b"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "a" })).not.toHaveClass(
      "lzs-chip--active",
    );
    expect(screen.getByRole("button", { name: "b" })).toHaveClass(
      "lzs-chip--active",
    );
    expect(screen.getByRole("button", { name: "c" })).not.toHaveClass(
      "lzs-chip--active",
    );
  });

  it("clicking an unselected chip adds it to selection", () => {
    const onChange = vi.fn();
    render(
      <ChipGroup options={["a", "b"]} selected={["a"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("clicking a selected chip removes it from selection", () => {
    const onChange = vi.fn();
    render(
      <ChipGroup
        options={["a", "b"]}
        selected={["a", "b"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("respects minSelected — cannot deselect when at minimum", () => {
    const onChange = vi.fn();
    render(
      <ChipGroup
        options={["a", "b"]}
        selected={["a"]}
        onChange={onChange}
        minSelected={1}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("allows deselect when above minSelected", () => {
    const onChange = vi.fn();
    render(
      <ChipGroup
        options={["a", "b"]}
        selected={["a", "b"]}
        onChange={onChange}
        minSelected={1}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("uses labels map for display text", () => {
    render(
      <ChipGroup
        options={["relu", "tanh"]}
        selected={[]}
        onChange={vi.fn()}
        labels={{ relu: "ReLU", tanh: "Tanh" }}
      />,
    );
    expect(screen.getByRole("button", { name: "ReLU" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tanh" })).toBeInTheDocument();
  });

  it("sets aria-pressed=true on selected items", () => {
    render(
      <ChipGroup options={["a", "b"]} selected={["a"]} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "a" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "b" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("does not mutate the original selected array", () => {
    const onChange = vi.fn();
    const original = ["a"];
    render(
      <ChipGroup
        options={["a", "b"]}
        selected={original}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(original).toEqual(["a"]);
  });

  it("renders inside lzs-chip-group container", () => {
    const { container } = render(
      <ChipGroup options={["a"]} selected={[]} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".lzs-chip-group")).toBeInTheDocument();
  });
});
