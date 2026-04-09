import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { CalibrationSection } from "./CalibrationSection";

// CalibrationSection is an AccordionItem so it must be wrapped in Accordion
function renderCalibration(
  calibration: Record<string, unknown> | null,
  onChange: (calibration: Record<string, unknown> | null) => void,
) {
  return render(
    <Accordion type="single" collapsible defaultValue="calibration">
      <CalibrationSection calibration={calibration} onChange={onChange} />
    </Accordion>,
  );
}

describe("CalibrationSection", () => {
  afterEach(() => {
    cleanup();
  });

  describe("OFF state (calibration is null)", () => {
    it("renders Calibration heading", () => {
      renderCalibration(null, vi.fn());
      expect(screen.getByText("Calibration")).toBeInTheDocument();
    });

    it("switch is off when calibration is null", () => {
      renderCalibration(null, vi.fn());
      const switchEl = screen.getByRole("switch");
      expect(switchEl).toHaveAttribute("data-state", "unchecked");
    });

    it("does not show method select when off", () => {
      renderCalibration(null, vi.fn());
      expect(screen.queryByText("method")).toBeNull();
    });

    it("does not show n_splits when off", () => {
      renderCalibration(null, vi.fn());
      expect(screen.queryByText("n_splits")).toBeNull();
    });
  });

  describe("ON state (calibration is an object)", () => {
    const defaultCalibration = { method: "isotonic", n_splits: 5, params: {} };

    it("switch is on when calibration is set", () => {
      renderCalibration(defaultCalibration, vi.fn());
      const switchEl = screen.getByRole("switch");
      expect(switchEl).toHaveAttribute("data-state", "checked");
    });

    it("shows method label when on", () => {
      renderCalibration(defaultCalibration, vi.fn());
      expect(screen.getByText("method")).toBeInTheDocument();
    });

    it("shows n_splits label when on", () => {
      renderCalibration(defaultCalibration, vi.fn());
      expect(screen.getByText("n_splits")).toBeInTheDocument();
    });
  });

  describe("toggle behavior", () => {
    it("toggling ON calls onChange with defaults object", () => {
      const onChange = vi.fn();
      renderCalibration(null, onChange);
      const switchEl = screen.getByRole("switch");
      fireEvent.click(switchEl);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ method: "isotonic", n_splits: 5 }),
      );
    });

    it("toggling OFF calls onChange with null", () => {
      const onChange = vi.fn();
      renderCalibration(
        { method: "isotonic", n_splits: 5, params: {} },
        onChange,
      );
      const switchEl = screen.getByRole("switch");
      fireEvent.click(switchEl);
      expect(onChange).toHaveBeenCalledWith(null);
    });
  });
});
