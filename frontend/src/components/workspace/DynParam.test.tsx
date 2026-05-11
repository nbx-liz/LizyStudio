import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterHint } from "@/api/types";
import { DynParam } from "./DynParam";

// Helper to create a minimal ParameterHint
function hint(
  overrides: Partial<ParameterHint> & { kind: string },
): ParameterHint {
  return { key: "param_key", label: "My Label", ...overrides };
}

describe("DynParam", () => {
  describe("kind=objective → SegmentGroup", () => {
    it("renders a SegmentGroup with options", () => {
      render(
        <DynParam
          hint={hint({ kind: "objective", key: "objective" })}
          value="logloss"
          onChange={vi.fn()}
          options={["logloss", "auc"]}
        />,
      );
      expect(
        screen.getByRole("radio", { name: "logloss" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "auc" })).toBeInTheDocument();
    });

    it("fires onChange when a different segment is clicked", () => {
      const onChange = vi.fn();
      render(
        <DynParam
          hint={hint({ kind: "objective", key: "objective" })}
          value="logloss"
          onChange={onChange}
          options={["logloss", "auc"]}
        />,
      );
      fireEvent.click(screen.getByRole("radio", { name: "auc" }));
      expect(onChange).toHaveBeenCalledWith("auc");
    });

    it("renders nothing when options is empty", () => {
      const { container } = render(
        <DynParam
          hint={hint({ kind: "objective", key: "objective" })}
          value=""
          onChange={vi.fn()}
          options={[]}
        />,
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("kind=metric → ChipGroup (multi-select)", () => {
    it("renders a ChipGroup with options", () => {
      render(
        <DynParam
          hint={hint({ kind: "metric", key: "metric" })}
          value={["auc"]}
          onChange={vi.fn()}
          options={["auc", "logloss", "f1"]}
        />,
      );
      expect(screen.getByRole("button", { name: "auc" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "logloss" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "f1" })).toBeInTheDocument();
    });

    it("fires onChange with toggled array when chip is clicked", () => {
      const onChange = vi.fn();
      render(
        <DynParam
          hint={hint({ kind: "metric", key: "metric" })}
          value={["auc"]}
          onChange={onChange}
          options={["auc", "logloss"]}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "logloss" }));
      expect(onChange).toHaveBeenCalledWith(["auc", "logloss"]);
    });

    it("selected chips have aria-pressed=true", () => {
      render(
        <DynParam
          hint={hint({ kind: "metric", key: "metric" })}
          value={["auc"]}
          onChange={vi.fn()}
          options={["auc", "logloss"]}
        />,
      );
      expect(screen.getByRole("button", { name: "auc" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "logloss" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });

  describe("kind=integer → CompactStepper (step=1 default)", () => {
    it("renders a CompactStepper input", () => {
      render(
        <DynParam
          hint={hint({ kind: "integer", key: "n_estimators", default: 100 })}
          value={100}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("uses step=1 when no hint.step", () => {
      const onChange = vi.fn();
      render(
        <DynParam
          hint={hint({ kind: "integer", key: "n_estimators" })}
          value={10}
          onChange={onChange}
        />,
      );
      const incrementBtn = screen.getByRole("button", { name: "+" });
      fireEvent.click(incrementBtn);
      expect(onChange).toHaveBeenCalledWith(11);
    });

    it("uses hint.step when provided", () => {
      const onChange = vi.fn();
      render(
        <DynParam
          hint={hint({ kind: "integer", key: "depth", step: 2 })}
          value={6}
          onChange={onChange}
        />,
      );
      const incrementBtn = screen.getByRole("button", { name: "+" });
      fireEvent.click(incrementBtn);
      expect(onChange).toHaveBeenCalledWith(8);
    });
  });

  describe("kind=number → CompactStepper (step=0.01 default)", () => {
    it("renders a CompactStepper input", () => {
      render(
        <DynParam
          hint={hint({ kind: "number", key: "learning_rate" })}
          value={0.05}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("uses hint.step when provided", () => {
      const onChange = vi.fn();
      render(
        <DynParam
          hint={hint({ kind: "number", key: "learning_rate", step: 0.05 })}
          value={0.1}
          onChange={onChange}
        />,
      );
      const incrementBtn = screen.getByRole("button", { name: "+" });
      fireEvent.click(incrementBtn);
      const called = onChange.mock.calls[0][0] as number;
      expect(called).toBeCloseTo(0.15, 5);
    });
  });

  describe("kind=boolean → CompactToggle", () => {
    it("renders a checkbox input for CompactToggle", () => {
      render(
        <DynParam
          hint={hint({ kind: "boolean", key: "use_gpu" })}
          value={false}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });

    it("fires onChange with boolean when toggled", () => {
      const onChange = vi.fn();
      render(
        <DynParam
          hint={hint({ kind: "boolean", key: "use_gpu" })}
          value={false}
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByRole("checkbox"));
      expect(onChange).toHaveBeenCalledWith(true);
    });

    it("reflects checked state from value prop", () => {
      render(
        <DynParam
          hint={hint({ kind: "boolean", key: "use_gpu" })}
          value={true}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByRole("checkbox")).toBeChecked();
    });
  });

  describe("unknown kind → null", () => {
    it("renders nothing for unknown kind", () => {
      const { container } = render(
        <DynParam
          hint={hint({ kind: "unknown_kind", key: "foo" })}
          value={42}
          onChange={vi.fn()}
        />,
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("visible prop", () => {
    it("renders nothing when visible=false", () => {
      const { container } = render(
        <DynParam
          hint={hint({ kind: "integer", key: "n" })}
          value={100}
          onChange={vi.fn()}
          visible={false}
        />,
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("label display via FormRow", () => {
    it("renders hint.label as the label text", () => {
      render(
        <DynParam
          hint={hint({ kind: "integer", key: "n", label: "Estimators" })}
          value={100}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText("Estimators")).toBeInTheDocument();
    });
  });

  describe("description tooltip", () => {
    it("passes description to FormRow as title attribute", () => {
      render(
        <DynParam
          hint={hint({
            kind: "integer",
            key: "n",
            label: "Estimators",
            description: "Number of boosting rounds",
          })}
          value={100}
          onChange={vi.fn()}
        />,
      );
      const label = screen.getByText("Estimators");
      expect(label).toHaveAttribute("title", "Number of boosting rounds");
    });

    it("falls back to label when no description", () => {
      render(
        <DynParam
          hint={hint({ kind: "integer", key: "n", label: "Estimators" })}
          value={100}
          onChange={vi.fn()}
        />,
      );
      const label = screen.getByText("Estimators");
      expect(label).toHaveAttribute("title", "Estimators");
    });
  });

  describe("undefined value → hint.default used as actual value", () => {
    it("CompactStepper shows default value when value is undefined", () => {
      const onChange = vi.fn();
      render(
        <DynParam
          hint={hint({ kind: "integer", key: "n", default: 50 })}
          value={undefined}
          onChange={onChange}
        />,
      );
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("50");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("CompactStepper shows decimal default when value is undefined", () => {
      render(
        <DynParam
          hint={hint({ kind: "number", key: "lr", default: 0.01 })}
          value={undefined}
          onChange={vi.fn()}
        />,
      );
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("0.01");
    });
  });
});
