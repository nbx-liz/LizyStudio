import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SavePresetDialog } from "./SavePresetDialog";

describe("SavePresetDialog", () => {
  it("renders dialog with themed input and focuses it on open", async () => {
    render(<SavePresetDialog open onOpenChange={() => {}} onSave={() => {}} />);

    const input = await screen.findByLabelText(/name/i);
    expect(input).toBeInTheDocument();

    // Dialog auto-focuses the input shortly after mount.
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
  });

  it("disables save button when name is empty", async () => {
    render(<SavePresetDialog open onOpenChange={() => {}} onSave={() => {}} />);

    const save = await screen.findByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
  });

  it("enables save button and calls onSave with the trimmed name", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <SavePresetDialog open onOpenChange={onOpenChange} onSave={onSave} />,
    );

    const input = await screen.findByLabelText(/name/i);
    await user.type(input, "  my-preset  ");

    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).not.toBeDisabled();
    await user.click(save);

    expect(onSave).toHaveBeenCalledWith("my-preset");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("rejects duplicate names with a visible error and blocks save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <SavePresetDialog
        open
        onOpenChange={() => {}}
        onSave={onSave}
        existingNames={["dup"]}
      />,
    );

    const input = await screen.findByLabelText(/name/i);
    await user.type(input, "dup");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already exists/i,
    );
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("cancel button closes the dialog without saving", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <SavePresetDialog open onOpenChange={onOpenChange} onSave={onSave} />,
    );

    const input = await screen.findByLabelText(/name/i);
    await user.type(input, "x");

    const cancel = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancel);

    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submit via Enter key saves when valid", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<SavePresetDialog open onOpenChange={() => {}} onSave={onSave} />);

    const input = await screen.findByLabelText(/name/i);
    await user.type(input, "via-enter{Enter}");

    expect(onSave).toHaveBeenCalledWith("via-enter");
  });
});
