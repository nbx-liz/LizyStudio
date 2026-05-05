/**
 * Tests for ConfigEditorBody — the scrollable host for ConfigForm / TuneTab.
 *
 * Focus is on the validation/error banners. Body-level form rendering is
 * already covered by ConfigForm.test.tsx and TuneTab.test.tsx.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigEditorBody } from "./ConfigEditorBody";

vi.mock("./ConfigForm", () => ({
  ConfigForm: () => <div data-testid="config-form-stub" />,
}));
vi.mock("./TuneTab", () => ({
  TuneTab: () => <div data-testid="tune-tab-stub" />,
}));

function renderBody(
  props: Partial<React.ComponentProps<typeof ConfigEditorBody>> = {},
) {
  const baseProps: React.ComponentProps<typeof ConfigEditorBody> = {
    activeTab: "tune",
    hasData: true,
    running: false,
    errors: [],
    schema: { type: "object" },
    config: { model: {}, tuning: { optuna: { space: {} } } },
    onChange: vi.fn(),
    task: "binary",
    uiSchema: {},
    columns: [],
    ...props,
  };
  return render(
    <TooltipProvider>
      <ConfigEditorBody {...baseProps} />
    </TooltipProvider>,
  );
}

describe("ConfigEditorBody — empty Choice banner (Issue #266)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not render the banner when emptyChoiceKeys is empty", () => {
    renderBody({ emptyChoiceKeys: [] });
    expect(screen.queryByTestId("empty-choice-banner")).toBeNull();
  });

  it("does not render the banner on the Fit tab even with empty choices", () => {
    renderBody({ activeTab: "fit", emptyChoiceKeys: ["objective"] });
    expect(screen.queryByTestId("empty-choice-banner")).toBeNull();
  });

  it("renders the banner listing offending parameter keys on the Tune tab", () => {
    renderBody({
      activeTab: "tune",
      emptyChoiceKeys: ["objective", "metric"],
    });
    const banner = screen.getByTestId("empty-choice-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("objective");
    expect(banner.textContent).toContain("metric");
  });
});

describe("ConfigEditorBody — severity-aware error/warning banners (Issue #394)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders blocking errors in the destructive banner only", () => {
    renderBody({
      errors: [
        {
          path: "split.n_splits",
          message: "n_splits=1000 > n_rows=50",
          severity: "error",
          suggested_fix: "Set Folds to 50 or fewer.",
        },
      ],
    });
    expect(screen.getByTestId("config-error-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("config-warning-banner")).toBeNull();
  });

  it("renders advisory warnings in the warning banner only", () => {
    renderBody({
      errors: [
        {
          path: "evaluation.metrics",
          message: "MAPE is undefined when target column 'y' contains zeros.",
          severity: "warning",
          suggested_fix:
            "Remove 'mape' from evaluation.metrics — or replace with 'smape'.",
        },
      ],
    });
    const warning = screen.getByTestId("config-warning-banner");
    expect(warning).toBeInTheDocument();
    expect(screen.queryByTestId("config-error-banner")).toBeNull();
    // Both the message and the suggestion render.
    expect(warning.textContent).toContain("MAPE is undefined");
    expect(warning.textContent).toContain(
      "Remove 'mape' from evaluation.metrics",
    );
  });

  it("splits a mixed list across both banners", () => {
    renderBody({
      errors: [
        {
          path: "split.n_splits",
          message: "n_splits=1000 > n_rows=50",
          severity: "error",
          suggested_fix: "Set Folds to 50 or fewer.",
        },
        {
          path: "evaluation.metrics",
          message: "MAPE is undefined when target column 'y' contains zeros.",
          severity: "warning",
          suggested_fix: "Remove 'mape' from evaluation.metrics.",
        },
      ],
    });
    const error = screen.getByTestId("config-error-banner");
    const warning = screen.getByTestId("config-warning-banner");
    expect(error.textContent).toContain("n_splits=1000");
    expect(error.textContent).not.toContain("MAPE is undefined");
    expect(warning.textContent).toContain("MAPE is undefined");
    expect(warning.textContent).not.toContain("n_splits=1000");
  });

  it("treats missing severity as 'error' (backward compatibility)", () => {
    renderBody({
      errors: [
        {
          path: "task",
          message: "Invalid task value",
        },
      ],
    });
    expect(screen.getByTestId("config-error-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("config-warning-banner")).toBeNull();
  });

  it("hides both banners when hasData is false", () => {
    renderBody({
      hasData: false,
      errors: [
        {
          path: "split.n_splits",
          message: "n_splits=1000 > n_rows=50",
          severity: "error",
          suggested_fix: null,
        },
        {
          path: "evaluation.metrics",
          message: "MAPE is undefined",
          severity: "warning",
          suggested_fix: "Remove 'mape'.",
        },
      ],
    });
    expect(screen.queryByTestId("config-error-banner")).toBeNull();
    expect(screen.queryByTestId("config-warning-banner")).toBeNull();
  });

  it("renders a warning entry without a suggested_fix", () => {
    renderBody({
      errors: [
        {
          path: "evaluation.metrics",
          message: "Some warning text.",
          severity: "warning",
        },
      ],
    });
    const warning = screen.getByTestId("config-warning-banner");
    expect(warning.textContent).toContain("Some warning text.");
    expect(warning.textContent).not.toContain("Suggestion:");
  });
});
