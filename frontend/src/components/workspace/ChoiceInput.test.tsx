import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChoiceInput } from "./ChoiceInput";

describe("ChoiceInput — with availableOptions (chip badge mode)", () => {
  it("renders a badge for each available option", () => {
    render(
      <ChoiceInput
        choices={[]}
        onChange={vi.fn()}
        availableOptions={["relu", "tanh", "sigmoid"]}
      />,
    );
    expect(screen.getByText("relu")).toBeInTheDocument();
    expect(screen.getByText("tanh")).toBeInTheDocument();
    expect(screen.getByText("sigmoid")).toBeInTheDocument();
  });

  it("marks already-selected options as selected", () => {
    render(
      <ChoiceInput
        choices={["relu"]}
        onChange={vi.fn()}
        availableOptions={["relu", "tanh"]}
      />,
    );
    const reluBtn = screen.getByRole("button", { name: "relu" });
    const tanhBtn = screen.getByRole("button", { name: "tanh" });
    expect(reluBtn).toHaveAttribute("aria-pressed", "true");
    expect(tanhBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking an unselected chip calls onChange with it added", () => {
    const onChange = vi.fn();
    render(
      <ChoiceInput
        choices={["relu"]}
        onChange={onChange}
        availableOptions={["relu", "tanh"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "tanh" }));
    expect(onChange).toHaveBeenCalledWith(["relu", "tanh"]);
  });

  it("clicking a selected chip calls onChange with it removed", () => {
    const onChange = vi.fn();
    render(
      <ChoiceInput
        choices={["relu", "tanh"]}
        onChange={onChange}
        availableOptions={["relu", "tanh"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "relu" }));
    expect(onChange).toHaveBeenCalledWith(["tanh"]);
  });

  it("does not mutate the original choices array", () => {
    const onChange = vi.fn();
    const original = ["relu"];
    render(
      <ChoiceInput
        choices={original}
        onChange={onChange}
        availableOptions={["relu", "tanh"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "tanh" }));
    expect(original).toEqual(["relu"]);
  });
});

describe("ChoiceInput — free-text mode (no availableOptions)", () => {
  it("renders a text input when no availableOptions are provided", () => {
    render(<ChoiceInput choices={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("does not render a text input when availableOptions are provided", () => {
    render(
      <ChoiceInput
        choices={[]}
        onChange={vi.fn()}
        availableOptions={["a", "b"]}
      />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("pressing Enter with a value adds it as a chip and calls onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChoiceInput choices={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "foo{Enter}");
    expect(onChange).toHaveBeenCalledWith(["foo"]);
  });

  it("typing a comma-separated value adds multiple chips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChoiceInput choices={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "foo,bar{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["foo", "bar"]);
  });

  it("shows existing choices as removable chip tags", () => {
    render(<ChoiceInput choices={["alpha", "beta"]} onChange={vi.fn()} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("clicking X on a chip removes it and calls onChange", () => {
    const onChange = vi.fn();
    render(<ChoiceInput choices={["alpha", "beta"]} onChange={onChange} />);
    // Each chip has a remove button with aria-label
    const removeAlpha = screen.getByRole("button", {
      name: /remove alpha/i,
    });
    fireEvent.click(removeAlpha);
    expect(onChange).toHaveBeenCalledWith(["beta"]);
  });

  it("clears input after submitting via Enter", async () => {
    const user = userEvent.setup();
    render(<ChoiceInput choices={[]} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "foo{Enter}");
    expect(input).toHaveValue("");
  });

  it("ignores empty or whitespace-only entries", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChoiceInput choices={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "   {Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not add duplicate entries", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChoiceInput choices={["foo"]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "foo{Enter}");
    // onChange still called but with no duplicates
    expect(onChange).toHaveBeenCalledWith(["foo"]);
  });
});
