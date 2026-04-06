import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FeatureWeightsEditor } from "./FeatureWeightsEditor";

const COLUMNS = ["feature_a", "feature_b", "feature_c"];

function renderEditor(props: Parameters<typeof FeatureWeightsEditor>[0]) {
  return render(
    <TooltipProvider>
      <FeatureWeightsEditor {...props} />
    </TooltipProvider>,
  );
}

describe("FeatureWeightsEditor", () => {
  afterEach(() => {
    cleanup();
  });

  describe("OFF state (weights is null)", () => {
    it("renders Feature Weights label", () => {
      renderEditor({ weights: null, columns: COLUMNS, onChange: vi.fn() });
      expect(screen.getByText("Feature Weights")).toBeInTheDocument();
    });

    it("switch is off when weights is null", () => {
      renderEditor({ weights: null, columns: COLUMNS, onChange: vi.fn() });
      const switchEl = screen.getByRole("switch");
      expect(switchEl).toHaveAttribute("data-state", "unchecked");
    });

    it("does not show any weight rows when off", () => {
      renderEditor({ weights: null, columns: COLUMNS, onChange: vi.fn() });
      expect(screen.queryByText("feature_a")).toBeNull();
      expect(screen.queryByText("feature_b")).toBeNull();
    });

    it("does not show Add feature selector when off", () => {
      renderEditor({ weights: null, columns: COLUMNS, onChange: vi.fn() });
      expect(screen.queryByText("Add feature...")).toBeNull();
    });
  });

  describe("ON state (weights is an object)", () => {
    it("switch is on when weights is set", () => {
      renderEditor({
        weights: { feature_a: 1.0 },
        columns: COLUMNS,
        onChange: vi.fn(),
      });
      const switchEl = screen.getByRole("switch");
      expect(switchEl).toHaveAttribute("data-state", "checked");
    });

    it("shows existing weight rows", () => {
      renderEditor({
        weights: { feature_a: 1.0, feature_b: 2.0 },
        columns: COLUMNS,
        onChange: vi.fn(),
      });
      expect(screen.getByText("feature_a")).toBeInTheDocument();
      expect(screen.getByText("feature_b")).toBeInTheDocument();
    });

    it("shows Add feature selector when enabled and columns available", () => {
      renderEditor({ weights: {}, columns: COLUMNS, onChange: vi.fn() });
      expect(screen.getByText("Add feature...")).toBeInTheDocument();
    });

    it("does not show Add feature selector when all columns are used", () => {
      renderEditor({
        weights: { feature_a: 1.0, feature_b: 1.0, feature_c: 1.0 },
        columns: COLUMNS,
        onChange: vi.fn(),
      });
      expect(screen.queryByText("Add feature...")).toBeNull();
    });
  });

  describe("toggle", () => {
    it("toggling ON calls onChange with empty object", () => {
      const onChange = vi.fn();
      renderEditor({ weights: null, columns: COLUMNS, onChange });
      fireEvent.click(screen.getByRole("switch"));
      expect(onChange).toHaveBeenCalledWith({});
    });

    it("toggling OFF calls onChange with null", () => {
      const onChange = vi.fn();
      renderEditor({ weights: { feature_a: 1.0 }, columns: COLUMNS, onChange });
      fireEvent.click(screen.getByRole("switch"));
      expect(onChange).toHaveBeenCalledWith(null);
    });
  });

  describe("remove row", () => {
    it("clicking remove button calls onChange without that key", () => {
      const onChange = vi.fn();
      renderEditor({
        weights: { feature_a: 1.0, feature_b: 2.0 },
        columns: COLUMNS,
        onChange,
      });
      // Each row has: decrement btn, increment btn, X (remove) btn
      // For two rows the order is: [dec_a, inc_a, X_a, dec_b, inc_b, X_b]
      // Click the first X button (index 2) to remove feature_a
      const allButtons = screen.getAllByRole("button");
      const removeBtn = allButtons[2];
      fireEvent.click(removeBtn);
      expect(onChange).toHaveBeenCalledWith({ feature_b: 2.0 });
    });
  });
});
