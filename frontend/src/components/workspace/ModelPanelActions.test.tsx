import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ConfigPreset } from "@/hooks/useConfigPresets";
import { ModelPanelActions } from "./ModelPanelActions";

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

vi.mock("@/api/workspace", () => ({
  getConfigDownloadUrl: () => "/api/workspace/config/download",
}));

vi.mock("./RawConfigDialog", () => ({
  RawConfigDialog: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="raw-config-dialog">{trigger}</div>
  ),
}));

afterEach(cleanup);

const PRESETS: ConfigPreset[] = [
  {
    name: "preset-A",
    config: { task: "binary" } as Record<string, unknown>,
    createdAt: "2026-05-03T00:00:00Z",
  },
  {
    name: "preset-B",
    config: { task: "regression" } as Record<string, unknown>,
    createdAt: "2026-05-03T00:00:00Z",
  },
];

const baseProps = {
  running: false,
  config: { task: "binary" } as Record<string, unknown>,
  canUndo: false,
  canRedo: false,
  presets: PRESETS,
  onImport: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onOpenSavePreset: vi.fn(),
  onLoadPreset: vi.fn(),
};

describe("ModelPanelActions / LoadPresetMenu (Issue #369)", () => {
  it("does not render the Load Preset menu when no presets are saved", () => {
    renderWithTooltip(<ModelPanelActions {...baseProps} presets={[]} />);
    expect(
      screen.queryByRole("button", { name: "Load preset" }),
    ).not.toBeInTheDocument();
  });

  it("renders one menuitem per preset", async () => {
    const user = userEvent.setup();
    renderWithTooltip(<ModelPanelActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "Load preset" }));

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(PRESETS.length);
    expect(items[0]).toHaveTextContent("preset-A");
    expect(items[1]).toHaveTextContent("preset-B");
  });

  // Issue #369: the original Select component swallowed re-clicks on
  // the same value. The menuitem-based replacement must always fire
  // ``onLoadPreset`` when the user clicks a preset, even if it was the
  // last one applied.
  it("fires onLoadPreset every time the same preset is clicked", async () => {
    const user = userEvent.setup();
    const onLoadPreset = vi.fn();
    renderWithTooltip(
      <ModelPanelActions {...baseProps} onLoadPreset={onLoadPreset} />,
    );

    // First click
    await user.click(screen.getByRole("button", { name: "Load preset" }));
    await user.click(screen.getByRole("menuitem", { name: "preset-A" }));
    expect(onLoadPreset).toHaveBeenCalledTimes(1);
    expect(onLoadPreset).toHaveBeenLastCalledWith("preset-A");

    // Re-open and click the SAME preset again — must re-fire.
    await user.click(screen.getByRole("button", { name: "Load preset" }));
    await user.click(screen.getByRole("menuitem", { name: "preset-A" }));
    expect(onLoadPreset).toHaveBeenCalledTimes(2);
    expect(onLoadPreset).toHaveBeenLastCalledWith("preset-A");
  });

  it("closes the menu after a preset is selected", async () => {
    const user = userEvent.setup();
    renderWithTooltip(<ModelPanelActions {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Load preset" }));
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("menuitem", { name: "preset-B" }));

    // The popover should auto-dismiss after selection.
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
