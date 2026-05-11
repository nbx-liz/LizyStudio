import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { RetuneSettingsSection } from "./RetuneSettingsSection";

function renderWithAccordion(
  config: Record<string, unknown>,
  onChange: (config: Record<string, unknown>) => void,
) {
  return render(
    <Accordion type="multiple" defaultValue={["retune"]}>
      <RetuneSettingsSection config={config} onChange={onChange} />
    </Accordion>,
  );
}

describe("RetuneSettingsSection", () => {
  describe("read: Switch state derived from tuning.re_tune", () => {
    it("renders Switch OFF and hides sub-inputs when tuning.re_tune is absent", () => {
      renderWithAccordion({}, vi.fn());
      const sw = screen.getByRole("switch", {
        name: /enable re-tune/i,
      }) as HTMLButtonElement;
      expect(sw.getAttribute("aria-checked")).toBe("false");
      expect(screen.queryByLabelText(/number of rounds/i)).toBeNull();
      expect(screen.queryByLabelText(/boundary threshold/i)).toBeNull();
    });

    it("renders Switch OFF and hides sub-inputs when tuning.re_tune is null", () => {
      renderWithAccordion({ tuning: { re_tune: null } }, vi.fn());
      const sw = screen.getByRole("switch", {
        name: /enable re-tune/i,
      }) as HTMLButtonElement;
      expect(sw.getAttribute("aria-checked")).toBe("false");
      expect(screen.queryByLabelText(/number of rounds/i)).toBeNull();
    });

    it("auto-migrates legacy {n_rounds:1, ...} to Switch OFF (D2 backward-compat)", () => {
      // Pre-Wave-2.1 the UI saved the buggy off-state as a populated object
      // with n_rounds=1. The new contract treats this as OFF on read and
      // will write null on the next save.
      const config = {
        tuning: {
          re_tune: {
            n_rounds: 1,
            expand_boundary: true,
            boundary_threshold: 0.05,
          },
        },
      };
      renderWithAccordion(config, vi.fn());
      const sw = screen.getByRole("switch", {
        name: /enable re-tune/i,
      }) as HTMLButtonElement;
      expect(sw.getAttribute("aria-checked")).toBe("false");
      expect(screen.queryByLabelText(/number of rounds/i)).toBeNull();
    });

    it("renders Switch ON and shows sub-inputs when n_rounds > 1", () => {
      const config = {
        tuning: {
          re_tune: {
            n_rounds: 4,
            expand_boundary: false,
            boundary_threshold: 0.2,
          },
        },
      };
      renderWithAccordion(config, vi.fn());
      const sw = screen.getByRole("switch", {
        name: /enable re-tune/i,
      }) as HTMLButtonElement;
      expect(sw.getAttribute("aria-checked")).toBe("true");
      expect(
        (screen.getByLabelText(/number of rounds/i) as HTMLInputElement).value,
      ).toBe("4");
      expect(
        (screen.getByLabelText(/boundary threshold/i) as HTMLInputElement)
          .value,
      ).toBe("0.2");
    });
  });

  describe("write: Switch toggling drives the wire payload", () => {
    it("writes tuning.re_tune = null when toggled OFF", () => {
      const onChange = vi.fn();
      const config = {
        tuning: {
          re_tune: {
            n_rounds: 3,
            expand_boundary: true,
            boundary_threshold: 0.05,
          },
        },
      };
      renderWithAccordion(config, onChange);
      const sw = screen.getByRole("switch", { name: /enable re-tune/i });
      fireEvent.click(sw);
      expect(onChange).toHaveBeenCalledTimes(1);
      const patched = onChange.mock.calls[0][0] as {
        tuning: { re_tune: unknown };
      };
      expect(patched.tuning.re_tune).toBeNull();
    });

    it("writes ON_DEFAULTS {n_rounds:3, ...} when toggled from absent to ON", () => {
      const onChange = vi.fn();
      renderWithAccordion({}, onChange);
      const sw = screen.getByRole("switch", { name: /enable re-tune/i });
      fireEvent.click(sw);
      expect(onChange).toHaveBeenCalledTimes(1);
      const patched = onChange.mock.calls[0][0] as {
        tuning: {
          re_tune: {
            n_rounds: number;
            expand_boundary: boolean;
            boundary_threshold: number;
          };
        };
      };
      expect(patched.tuning.re_tune).toEqual({
        n_rounds: 3,
        expand_boundary: true,
        boundary_threshold: 0.05,
      });
    });

    it("writes ON_DEFAULTS when toggled from legacy {n_rounds:1, ...} to ON", () => {
      // Auto-migrated legacy payload is treated as OFF; toggling ON starts
      // fresh from ON_DEFAULTS rather than restoring the legacy n_rounds=1.
      const onChange = vi.fn();
      const config = {
        tuning: {
          re_tune: {
            n_rounds: 1,
            expand_boundary: false,
            boundary_threshold: 0.1,
          },
        },
      };
      renderWithAccordion(config, onChange);
      const sw = screen.getByRole("switch", { name: /enable re-tune/i });
      fireEvent.click(sw);
      const patched = onChange.mock.calls[0][0] as {
        tuning: {
          re_tune: {
            n_rounds: number;
            expand_boundary: boolean;
            boundary_threshold: number;
          };
        };
      };
      expect(patched.tuning.re_tune.n_rounds).toBe(3);
    });
  });

  describe("edits while ON", () => {
    it("writes n_rounds via onChange patched into tuning.re_tune", () => {
      const onChange = vi.fn();
      const config = {
        tuning: { re_tune: { n_rounds: 3 } },
      };
      renderWithAccordion(config, onChange);
      fireEvent.change(screen.getByLabelText(/number of rounds/i), {
        target: { value: "5" },
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      const patched = onChange.mock.calls[0][0] as {
        tuning: { re_tune: { n_rounds: number } };
      };
      expect(patched.tuning.re_tune.n_rounds).toBe(5);
    });

    it("clamps n_rounds to [1, 10]", () => {
      const onChange = vi.fn();
      const config = { tuning: { re_tune: { n_rounds: 3 } } };
      renderWithAccordion(config, onChange);
      fireEvent.change(screen.getByLabelText(/number of rounds/i), {
        target: { value: "999" },
      });
      const patched = onChange.mock.calls[0][0] as {
        tuning: { re_tune: { n_rounds: number } };
      };
      expect(patched.tuning.re_tune.n_rounds).toBe(10);
    });

    it("clamps boundary_threshold to [0, 0.49]", () => {
      const onChange = vi.fn();
      renderWithAccordion({ tuning: { re_tune: { n_rounds: 2 } } }, onChange);
      fireEvent.change(screen.getByLabelText(/boundary threshold/i), {
        target: { value: "0.99" },
      });
      const patched = onChange.mock.calls[0][0] as {
        tuning: { re_tune: { boundary_threshold: number } };
      };
      expect(patched.tuning.re_tune.boundary_threshold).toBe(0.49);
    });

    it("toggles expand_boundary via checkbox click", () => {
      const onChange = vi.fn();
      const config = {
        tuning: { re_tune: { n_rounds: 3, expand_boundary: true } },
      };
      renderWithAccordion(config, onChange);
      const checkbox = screen.getByLabelText(
        /expand boundary between rounds/i,
      ) as HTMLButtonElement;
      fireEvent.click(checkbox);
      expect(onChange).toHaveBeenCalledTimes(1);
      const patched = onChange.mock.calls[0][0] as {
        tuning: { re_tune: { expand_boundary: boolean } };
      };
      expect(patched.tuning.re_tune.expand_boundary).toBe(false);
    });

    it("preserves other tuning fields when writing re_tune", () => {
      const onChange = vi.fn();
      const config = {
        tuning: {
          optuna: { params: { n_trials: 100 } },
          evaluation: { metrics: ["auc"] },
          re_tune: { n_rounds: 3 },
        },
      };
      renderWithAccordion(config, onChange);
      fireEvent.change(screen.getByLabelText(/number of rounds/i), {
        target: { value: "5" },
      });
      const patched = onChange.mock.calls[0][0] as {
        tuning: {
          optuna: { params: { n_trials: number } };
          evaluation: { metrics: string[] };
          re_tune: { n_rounds: number };
        };
      };
      expect(patched.tuning.optuna.params.n_trials).toBe(100);
      expect(patched.tuning.evaluation.metrics).toEqual(["auc"]);
      expect(patched.tuning.re_tune.n_rounds).toBe(5);
    });
  });
});
