import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompactToggle } from "./CompactToggle";

describe("CompactToggle", () => {
  it("renders unchecked state", () => {
    render(<CompactToggle checked={false} onChange={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
  });

  it("renders checked state", () => {
    render(<CompactToggle checked={true} onChange={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
  });

  it("clicking calls onChange with toggled value when unchecked", () => {
    const onChange = vi.fn();
    render(<CompactToggle checked={false} onChange={onChange} />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("clicking calls onChange with toggled value when checked", () => {
    const onChange = vi.fn();
    render(<CompactToggle checked={true} onChange={onChange} />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("disabled state prevents interaction", () => {
    const onChange = vi.fn();
    render(<CompactToggle checked={false} onChange={onChange} disabled />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders inside lzs-toggle label", () => {
    const { container } = render(
      <CompactToggle checked={false} onChange={vi.fn()} />,
    );
    expect(container.querySelector("label.lzs-toggle")).toBeInTheDocument();
  });

  it("renders a lzs-toggle__slider span", () => {
    const { container } = render(
      <CompactToggle checked={false} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".lzs-toggle__slider")).toBeInTheDocument();
  });

  it("onChange handler guard fires — invoke React fiber handler directly with disabled=true", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CompactToggle checked={false} onChange={onChange} disabled />,
    );
    const checkbox = container.querySelector("input") as HTMLInputElement;
    // React 18 stores internal fiber on the DOM node; retrieve the onChange handler
    // directly to exercise the guard at line 19.
    const fiberKey = Object.keys(checkbox).find(
      (k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternals"),
    );
    if (fiberKey) {
      // Walk up to find the fiber with an onChange memoizedProps
      let fiber = (checkbox as unknown as Record<string, unknown>)[
        fiberKey
      ] as {
        memoizedProps?: {
          onChange?: (e: { target: { checked: boolean } }) => void;
        };
        return?: unknown;
      } | null;
      while (fiber && !fiber.memoizedProps?.onChange) {
        fiber = fiber.return as typeof fiber;
      }
      if (fiber?.memoizedProps?.onChange) {
        fiber.memoizedProps.onChange({ target: { checked: true } });
      }
    }
    // Guard at line 19 returns early — onChange prop should not be called
    expect(onChange).not.toHaveBeenCalled();
  });
});
