import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { N_TRIALS_PRESETS } from "./constants";
import { TuneSettings } from "./TuneSettings";

interface TuneSettingsProps {
  tuningParams: { n_trials?: number; timeout?: number | null };
  onChange: (params: Record<string, unknown>) => void;
  nTrialsPresets?: number[];
}

function renderTuneSettings(props: Partial<TuneSettingsProps> = {}) {
  const defaultProps: TuneSettingsProps = {
    tuningParams: { n_trials: 50, timeout: null },
    onChange: vi.fn(),
    ...props,
  };
  return render(
    <Accordion type="single" collapsible defaultValue="settings">
      <TuneSettings {...defaultProps} />
    </Accordion>,
  );
}

describe("TuneSettings", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 'Settings' heading", () => {
    renderTuneSettings();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders 'Number of trials' label", () => {
    renderTuneSettings();
    expect(screen.getByText("Number of trials")).toBeInTheDocument();
  });

  it("renders 'Timeout' label", () => {
    renderTuneSettings();
    expect(screen.getByText("Timeout")).toBeInTheDocument();
  });

  it("shows preset buttons for n_trials", () => {
    renderTuneSettings();
    for (const preset of N_TRIALS_PRESETS) {
      expect(
        screen.getByRole("button", { name: String(preset) }),
      ).toBeInTheDocument();
    }
  });

  it("uses custom nTrialsPresets when provided", () => {
    const custom = [25, 75, 150];
    renderTuneSettings({ nTrialsPresets: custom });
    for (const preset of custom) {
      expect(
        screen.getByRole("button", { name: String(preset) }),
      ).toBeInTheDocument();
    }
    // Default presets that are not in custom should not appear
    for (const preset of N_TRIALS_PRESETS) {
      if (!custom.includes(preset)) {
        expect(
          screen.queryByRole("button", { name: String(preset) }),
        ).not.toBeInTheDocument();
      }
    }
  });
});
