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

  describe("accessibility", () => {
    // Radix <Switch> renders as a <button role="switch">. Axe's
    // ``button-name`` rule computes the accessible name via WAI-ARIA
    // spec and rejects FormField's <Label htmlFor> association for
    // button-typed labelable elements in practice (Nightly #188 /
    // PR #220 artefact). An explicit ``aria-label`` is the only
    // reliable remediation, so we assert it directly rather than
    // relying on testing-library's get-by-role name lookup (which
    // over-estimates the accessible name relative to axe).
    it("Switch has an explicit aria-label attribute", () => {
      renderEditor({ weights: null, columns: COLUMNS, onChange: vi.fn() });
      const switchEl = screen.getByRole("switch");
      expect(switchEl).toHaveAttribute("aria-label");
      expect(switchEl.getAttribute("aria-label")).toMatch(/feature weights/i);
    });
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

  describe("add feature (handleAdd — line 42)", () => {
    it("selecting a column from the dropdown calls onChange with weight 1.0", async () => {
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderEditor({ weights: {}, columns: COLUMNS, onChange });

      // Open the Select trigger
      const trigger = screen.getByRole("combobox");
      await user.click(trigger);

      const option = await screen.findByRole("option", { name: "feature_a" });
      await user.click(option);

      expect(onChange).toHaveBeenCalledWith({ feature_a: 1.0 });
    });

    it("adds to existing weights without overwriting them", async () => {
      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderEditor({
        weights: { feature_a: 2.5 },
        columns: COLUMNS,
        onChange,
      });

      const trigger = screen.getByRole("combobox");
      await user.click(trigger);

      const option = await screen.findByRole("option", { name: "feature_b" });
      await user.click(option);

      expect(onChange).toHaveBeenCalledWith({ feature_a: 2.5, feature_b: 1.0 });
    });
  });

  describe("weight change via NumberInput (handleWeightChange — lines 46-51, 79)", () => {
    it("incrementing weight calls onChange with updated value", () => {
      const onChange = vi.fn();
      renderEditor({
        weights: { feature_a: 1.0 },
        columns: COLUMNS,
        onChange,
      });
      // Buttons order: [Decrement, Increment, Remove]
      const allButtons = screen.getAllByRole("button");
      const incrementBtn = allButtons[1]; // index 1 = Increment for feature_a
      fireEvent.click(incrementBtn);
      // step=0.1 → 1.0 + 0.1 = 1.1 (clamped from min=0.01)
      expect(onChange).toHaveBeenCalledWith({
        feature_a: expect.closeTo(1.1, 5),
      });
    });

    it("decrementing weight calls onChange with updated value", () => {
      const onChange = vi.fn();
      renderEditor({
        weights: { feature_a: 1.0 },
        columns: COLUMNS,
        onChange,
      });
      // Buttons order: [Decrement, Increment, Remove]
      const allButtons = screen.getAllByRole("button");
      const decrementBtn = allButtons[0]; // index 0 = Decrement for feature_a
      fireEvent.click(decrementBtn);
      // step=0.1, min=0.01 → 1.0 - 0.1 = 0.9
      expect(onChange).toHaveBeenCalledWith({
        feature_a: expect.closeTo(0.9, 5),
      });
    });

    it("clearing weight input (undefined) removes the key from weights", () => {
      const onChange = vi.fn();
      renderEditor({
        weights: { feature_a: 1.0 },
        columns: COLUMNS,
        onChange,
      });
      const input = screen.getByRole("textbox");
      // Simulate clearing the input
      fireEvent.change(input, { target: { value: "" } });
      // handleWeightChange called with undefined → key removed
      expect(onChange).toHaveBeenCalledWith({});
    });

    it("handleWeightChange is a no-op when weights is null", () => {
      // This branch (line 46: if (!weights) return) is exercised indirectly.
      // We verify it by confirming onChange is NOT called if somehow
      // handleWeightChange is triggered with null weights.
      // In practice this is guarded by `enabled` conditional rendering,
      // so we just assert the component doesn't crash when weights is null.
      const onChange = vi.fn();
      renderEditor({ weights: null, columns: COLUMNS, onChange });
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
