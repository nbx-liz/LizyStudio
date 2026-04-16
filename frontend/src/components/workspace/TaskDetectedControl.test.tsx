import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskType } from "@/hooks/useDataPanel";
import { TaskDetectedControl } from "./TaskDetectedControl";

const TASK_OPTIONS: TaskType[] = ["binary", "multiclass", "regression"];

function renderControl(
  props: Partial<Parameters<typeof TaskDetectedControl>[0]> = {},
) {
  const defaults = {
    value: null as TaskType | null,
    detected: null as TaskType | null,
    disabled: false,
    onChange: vi.fn(),
  };
  return render(<TaskDetectedControl {...defaults} {...props} />);
}

describe("TaskDetectedControl", () => {
  afterEach(() => {
    cleanup();
  });

  describe("rendering task options", () => {
    it("renders all three task radio buttons", () => {
      renderControl({ value: "binary" });
      expect(screen.getByRole("radio", { name: "binary" })).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: "multiclass" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: "regression" }),
      ).toBeInTheDocument();
    });

    it("marks the current value as checked", () => {
      renderControl({ value: "regression" });
      expect(screen.getByRole("radio", { name: "regression" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    it("other options are not checked", () => {
      renderControl({ value: "binary" });
      expect(screen.getByRole("radio", { name: "multiclass" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(screen.getByRole("radio", { name: "regression" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });
  });

  describe("auto-detected badge (lines 32-35)", () => {
    it("shows 'Auto-detected' badge when detected matches value", () => {
      renderControl({ value: "binary", detected: "binary" });
      expect(screen.getByText("Auto-detected")).toBeInTheDocument();
    });

    it("does not show badge when detected differs from value", () => {
      renderControl({ value: "multiclass", detected: "binary" });
      expect(screen.queryByText("Auto-detected")).toBeNull();
    });

    it("does not show badge when detected is null", () => {
      renderControl({ value: "binary", detected: null });
      expect(screen.queryByText("Auto-detected")).toBeNull();
    });

    it("does not show badge when value is null", () => {
      renderControl({ value: null, detected: "binary" });
      expect(screen.queryByText("Auto-detected")).toBeNull();
    });
  });

  describe("disabled state", () => {
    it("all radio buttons are disabled when disabled=true", () => {
      renderControl({ value: "binary", disabled: true });
      for (const name of TASK_OPTIONS) {
        expect(screen.getByRole("radio", { name })).toBeDisabled();
      }
    });

    it("radio buttons are enabled by default", () => {
      renderControl({ value: "binary" });
      for (const name of TASK_OPTIONS) {
        expect(screen.getByRole("radio", { name })).not.toBeDisabled();
      }
    });
  });

  describe("onChange interaction (line 40)", () => {
    it("clicking a different task calls onChange with that task", () => {
      const onChange = vi.fn();
      renderControl({ value: "binary", onChange });
      fireEvent.click(screen.getByRole("radio", { name: "regression" }));
      expect(onChange).toHaveBeenCalledWith("regression");
    });

    it("clicking the active task does not call onChange", () => {
      const onChange = vi.fn();
      renderControl({ value: "multiclass", onChange });
      fireEvent.click(screen.getByRole("radio", { name: "multiclass" }));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("onChange is not called when disabled", () => {
      const onChange = vi.fn();
      renderControl({ value: "binary", disabled: true, onChange });
      fireEvent.click(screen.getByRole("radio", { name: "regression" }));
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
