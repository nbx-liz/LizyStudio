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
