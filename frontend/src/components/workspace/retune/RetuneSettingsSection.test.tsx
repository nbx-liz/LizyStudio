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
  it("reads default values when tuning.re_tune is absent", () => {
    renderWithAccordion({}, vi.fn());
    const nRounds = screen.getByLabelText(
      /number of rounds/i,
    ) as HTMLInputElement;
    const threshold = screen.getByLabelText(
      /boundary threshold/i,
    ) as HTMLInputElement;
    expect(nRounds.value).toBe("1");
    expect(threshold.value).toBe("0.05");
  });

  it("reads existing tuning.re_tune values", () => {
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
    expect(
      (screen.getByLabelText(/number of rounds/i) as HTMLInputElement).value,
    ).toBe("4");
    expect(
      (screen.getByLabelText(/boundary threshold/i) as HTMLInputElement).value,
    ).toBe("0.2");
  });

  it("writes n_rounds via onChange patched into tuning.re_tune", () => {
    const onChange = vi.fn();
    renderWithAccordion({}, onChange);
    fireEvent.change(screen.getByLabelText(/number of rounds/i), {
      target: { value: "3" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const patched = onChange.mock.calls[0][0] as {
      tuning: { re_tune: { n_rounds: number } };
    };
    expect(patched.tuning.re_tune.n_rounds).toBe(3);
  });

  it("clamps n_rounds to [1, 10]", () => {
    const onChange = vi.fn();
    renderWithAccordion({}, onChange);
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
    renderWithAccordion(
      {
        tuning: { re_tune: { n_rounds: 2 } },
      },
      onChange,
    );
    fireEvent.change(screen.getByLabelText(/boundary threshold/i), {
      target: { value: "0.99" },
    });
    const patched = onChange.mock.calls[0][0] as {
      tuning: { re_tune: { boundary_threshold: number } };
    };
    expect(patched.tuning.re_tune.boundary_threshold).toBe(0.49);
  });

  it("disables the form controls at the HTML level when n_rounds === 1", () => {
    renderWithAccordion({}, vi.fn());
    const checkbox = screen.getByLabelText(
      /expand boundary between rounds/i,
    ) as HTMLButtonElement;
    const threshold = screen.getByLabelText(
      /boundary threshold/i,
    ) as HTMLInputElement;
    expect(checkbox).toBeDisabled();
    expect(threshold).toBeDisabled();
    // n_rounds input stays enabled so the user can escape the disabled state
    const nRounds = screen.getByLabelText(
      /number of rounds/i,
    ) as HTMLInputElement;
    expect(nRounds).not.toBeDisabled();
  });

  it("enables expand_boundary + threshold controls when n_rounds > 1", () => {
    const config = {
      tuning: { re_tune: { n_rounds: 3 } },
    };
    renderWithAccordion(config, vi.fn());
    const checkbox = screen.getByLabelText(
      /expand boundary between rounds/i,
    ) as HTMLButtonElement;
    const threshold = screen.getByLabelText(
      /boundary threshold/i,
    ) as HTMLInputElement;
    expect(checkbox).not.toBeDisabled();
    expect(threshold).not.toBeDisabled();
  });

  it("toggles expand_boundary via checkbox click when enabled", () => {
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
      },
    };
    renderWithAccordion(config, onChange);
    fireEvent.change(screen.getByLabelText(/number of rounds/i), {
      target: { value: "2" },
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
    expect(patched.tuning.re_tune.n_rounds).toBe(2);
  });
});
