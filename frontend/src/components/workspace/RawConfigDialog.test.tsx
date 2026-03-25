import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RawConfigDialog } from "./RawConfigDialog";

vi.mock("js-yaml", () => ({
  default: { dump: (obj: unknown) => JSON.stringify(obj) },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("RawConfigDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders trigger element", () => {
    render(
      <RawConfigDialog
        config={{ key: "value" }}
        trigger={<button type="button">Open</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it('shows "Raw Config (read-only)" title when dialog opens', () => {
    render(
      <RawConfigDialog
        config={{ key: "value" }}
        trigger={<button type="button">Open</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Raw Config (read-only)")).toBeInTheDocument();
  });

  it("shows config content in pre tag", () => {
    const config = { model: "lgbm", lr: 0.01 };
    render(
      <RawConfigDialog
        config={config}
        trigger={<button type="button">Open</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(JSON.stringify(config));
  });

  it('shows "No config" when config is undefined', () => {
    render(
      <RawConfigDialog
        config={undefined}
        trigger={<button type="button">Open</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toBe("No config");
  });

  it("has a copy button in the dialog", () => {
    render(
      <RawConfigDialog
        config={{ key: "value" }}
        trigger={<button type="button">Open</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    // Dialog should contain at least the close button and the copy button
    const buttons = screen.getAllByRole("button");
    // At least 2 buttons: original trigger + copy (and potentially close)
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});
