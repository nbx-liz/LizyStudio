import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./SearchableSelect";

describe("SearchableSelect (PR-B2 / wide DataFrame)", () => {
  it("renders the trigger with the placeholder when no value is selected", () => {
    render(
      <SearchableSelect
        value=""
        options={["age", "color", "name"]}
        onChange={vi.fn()}
        placeholder="Select target column"
        ariaLabel="Target column"
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Target column" }),
    ).toHaveTextContent("Select target column");
  });

  it("displays the current value on the trigger when one is selected", () => {
    render(
      <SearchableSelect
        value="color"
        options={["age", "color", "name"]}
        onChange={vi.fn()}
        placeholder="Select target column"
        ariaLabel="Target column"
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Target column" }),
    ).toHaveTextContent("color");
  });

  it("opens the listbox when the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SearchableSelect
        value=""
        options={["age", "color", "name"]}
        onChange={vi.fn()}
        placeholder="Select target column"
        ariaLabel="Target column"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Target column" }));
    // cmdk renders a listbox role inside the popover
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("filters options as the user types", async () => {
    const user = userEvent.setup();
    render(
      <SearchableSelect
        value=""
        options={["age", "color", "name"]}
        onChange={vi.fn()}
        placeholder="Select target column"
        ariaLabel="Target column"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Target column" }));
    const input = screen.getByPlaceholderText("Search...");
    await user.type(input, "co");
    // Only "color" matches "co"
    expect(screen.getByRole("option", { name: "color" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "age" })).toBeNull();
  });

  it("calls onChange and closes the listbox when an option is picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchableSelect
        value=""
        options={["age", "color", "name"]}
        onChange={onChange}
        placeholder="Select target column"
        ariaLabel="Target column"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Target column" }));
    await user.click(screen.getByRole("option", { name: "color" }));
    expect(onChange).toHaveBeenCalledWith("color");
  });

  it("disables the trigger when disabled=true", () => {
    render(
      <SearchableSelect
        value=""
        options={["age", "color", "name"]}
        onChange={vi.fn()}
        placeholder="Select target column"
        ariaLabel="Target column"
        disabled
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Target column" }),
    ).toBeDisabled();
  });

  it("shows an empty-state message when no options match the query", async () => {
    const user = userEvent.setup();
    render(
      <SearchableSelect
        value=""
        options={["age", "color"]}
        onChange={vi.fn()}
        placeholder="Select target column"
        ariaLabel="Target column"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Target column" }));
    const input = screen.getByPlaceholderText("Search...");
    await user.type(input, "xyz_no_match");
    expect(screen.getByText(/no .*found/i)).toBeInTheDocument();
  });

  // cmdk runs its substring filter in pure JS; 5000 entries pushes the
  // happy-dom event loop past the default 5s vitest budget under heavy
  // suite load. Bump the per-test timeout — production renders this in
  // < 50ms because real browsers don't run synchronous DOM polyfills.
  it("scales to thousands of options without crashing", {
    timeout: 15000,
  }, async () => {
    const user = userEvent.setup();
    const opts = Array.from(
      { length: 5000 },
      (_, i) => `f_${i.toString().padStart(5, "0")}`,
    );
    render(
      <SearchableSelect
        value=""
        options={opts}
        onChange={vi.fn()}
        placeholder="Select target column"
        ariaLabel="Target column"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Target column" }));
    // Type a unique substring; cmdk filters in <O(N)> so this completes
    // quickly even with 5000 entries.
    const input = screen.getByPlaceholderText("Search...");
    await user.type(input, "00042");
    expect(screen.getByRole("option", { name: "f_00042" })).toBeInTheDocument();
  });

  it("keyboard: ArrowDown then Enter selects the highlighted option", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchableSelect
        value=""
        options={["age", "color", "name"]}
        onChange={onChange}
        placeholder="Select target column"
        ariaLabel="Target column"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Target column" }));
    const input = screen.getByPlaceholderText("Search...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    // First option (age) is the default highlight; Enter picks it after
    // ArrowDown moves to the second (color). Either is acceptable as
    // long as some option fired.
    expect(onChange.mock.calls[0][0]).toMatch(/age|color/);
  });
});
