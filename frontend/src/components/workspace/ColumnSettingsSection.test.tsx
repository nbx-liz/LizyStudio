import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "@/api/types";
import { ColumnSettingsSection } from "./ColumnSettingsSection";

/**
 * jsdom always reports zero-sized clientRects, which means
 * @tanstack/react-virtual measures the scroll viewport as 0 and would
 * either render nothing or fall back to mounting every row depending
 * on the version. Stub a non-zero size on the scroll element so the
 * virtualizer's measurement path matches what real browsers see, and
 * the wide-DataFrame guard tests can assert "fewer rows than columns
 * mounted at any one time".
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 320;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return 320;
    },
  });
});

const COLUMNS: ColumnInfo[] = [
  {
    name: "age",
    dtype: "float64",
    unique_count: 50,
    suggested_type: "numeric",
    suggested_excluded: false,
  },
  {
    name: "color",
    dtype: "object",
    unique_count: 3,
    suggested_type: "categorical",
    suggested_excluded: false,
  },
];

const SUMMARY = {
  total: 1,
  numeric: 1,
  categorical: 0,
  excluded: 0,
  idCount: 0,
  constCount: 0,
  manualCount: 0,
};

function renderSection(
  handlers: {
    onExcludeToggle?: (name: string, checked: boolean) => void;
    onTypeChange?: (name: string, type: "numeric" | "categorical") => void;
    onColumnExpand?: (name: string) => void;
  },
  options: { disabled?: boolean } = {},
) {
  const onExcludeToggle = handlers.onExcludeToggle ?? vi.fn();
  const onTypeChange = handlers.onTypeChange ?? vi.fn();
  const onColumnExpand = handlers.onColumnExpand ?? vi.fn();
  render(
    <ColumnSettingsSection
      columns={COLUMNS}
      target="age"
      overrides={{}}
      columnFilter=""
      onColumnFilterChange={() => {}}
      expandedCol={null}
      colStats={{}}
      summary={SUMMARY}
      onExcludeToggle={onExcludeToggle}
      onTypeChange={onTypeChange}
      onColumnExpand={onColumnExpand}
      disabled={options.disabled}
    />,
  );
  return { onExcludeToggle, onTypeChange, onColumnExpand };
}

describe("ColumnSettingsSection DOM structure (Issue #248)", () => {
  it("row container is not a <button> element (no nested interactive content)", () => {
    renderSection({});
    const row = screen.getByTestId("column-row-color");
    expect(row.tagName).not.toBe("BUTTON");
  });

  it("row container is keyboard-focusable and exposes button role", () => {
    renderSection({});
    const row = screen.getByTestId("column-row-color");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  it("row container is never a <button> that contains nested <button>s", () => {
    // The previous implementation rendered <Checkbox> (Radix button) and
    // Num / Cat <Button> inside an outer <button>, violating HTML and
    // breaking click handling in real browsers. Guard against regression
    // unconditionally — if the row ever becomes a <button> again, this
    // assertion must fail.
    renderSection({});
    const row = screen.getByTestId("column-row-color");
    if (row.tagName === "BUTTON") {
      expect(row.querySelectorAll("button").length).toBe(0);
    }
    expect(row.tagName).toBe("DIV");
  });

  it("row exposes aria-expanded reflecting expanded state", () => {
    renderSection({});
    const row = screen.getByTestId("column-row-color");
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("row exposes aria-label with the column name", () => {
    renderSection({});
    const row = screen.getByTestId("column-row-color");
    expect(row.getAttribute("aria-label")).toBe("color");
  });

  it("clicking the exclude checkbox calls onExcludeToggle and not onColumnExpand", () => {
    const { onExcludeToggle, onColumnExpand } = renderSection({});
    const row = screen.getByTestId("column-row-color");
    const checkbox = row.querySelector('[role="checkbox"]');
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox as HTMLElement);
    expect(onExcludeToggle).toHaveBeenCalledWith("color", true);
    expect(onColumnExpand).not.toHaveBeenCalled();
  });

  it("clicking the Num button calls onTypeChange and not onColumnExpand", async () => {
    const { onTypeChange, onColumnExpand } = renderSection({});
    const row = screen.getByTestId("column-row-color");
    const numButton = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "Num",
    );
    expect(numButton).toBeDefined();
    await userEvent.click(numButton as HTMLElement);
    expect(onTypeChange).toHaveBeenCalledWith("color", "numeric");
    expect(onColumnExpand).not.toHaveBeenCalled();
  });

  it("clicking the Cat button calls onTypeChange and not onColumnExpand", async () => {
    const { onTypeChange, onColumnExpand } = renderSection({});
    const row = screen.getByTestId("column-row-color");
    const catButton = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "Cat",
    );
    expect(catButton).toBeDefined();
    await userEvent.click(catButton as HTMLElement);
    expect(onTypeChange).toHaveBeenCalledWith("color", "categorical");
    expect(onColumnExpand).not.toHaveBeenCalled();
  });

  it("clicking the row body calls onColumnExpand", async () => {
    const { onColumnExpand } = renderSection({});
    const row = screen.getByTestId("column-row-color");
    await userEvent.click(row);
    expect(onColumnExpand).toHaveBeenCalledWith("color");
  });

  it("pressing Enter on the focused row calls onColumnExpand", () => {
    const { onColumnExpand } = renderSection({});
    const row = screen.getByTestId("column-row-color");
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onColumnExpand).toHaveBeenCalledWith("color");
  });

  it("pressing Space on the focused row calls onColumnExpand", () => {
    const { onColumnExpand } = renderSection({});
    const row = screen.getByTestId("column-row-color");
    row.focus();
    fireEvent.keyDown(row, { key: " " });
    expect(onColumnExpand).toHaveBeenCalledWith("color");
  });

  it("pressing Space on the focused row prevents default scroll", () => {
    renderSection({});
    const row = screen.getByTestId("column-row-color");
    row.focus();
    const result = fireEvent.keyDown(row, { key: " " });
    // fireEvent returns false when preventDefault was called on the event.
    expect(result).toBe(false);
  });

  it("keydown on the checkbox container does not bubble up to the row", () => {
    const { onColumnExpand } = renderSection({});
    const row = screen.getByTestId("column-row-color");
    const checkbox = row.querySelector('[role="checkbox"]');
    expect(checkbox).not.toBeNull();
    fireEvent.keyDown(checkbox as HTMLElement, { key: "Enter" });
    fireEvent.keyDown(checkbox as HTMLElement, { key: " " });
    expect(onColumnExpand).not.toHaveBeenCalled();
  });

  it("pressing a non-activation key on the row does not call onColumnExpand", () => {
    const { onColumnExpand } = renderSection({});
    const row = screen.getByTestId("column-row-color");
    row.focus();
    fireEvent.keyDown(row, { key: "Tab" });
    fireEvent.keyDown(row, { key: "a" });
    expect(onColumnExpand).not.toHaveBeenCalled();
  });
});

describe("ColumnSettingsSection running lock (P-0089 / Issue #279)", () => {
  it("disables Exclude checkbox when disabled=true", () => {
    renderSection({}, { disabled: true });
    const row = screen.getByTestId("column-row-color");
    const checkbox = row.querySelector('[role="checkbox"]') as HTMLElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox).toHaveAttribute("disabled");
  });

  it("disables Num and Cat buttons when disabled=true", () => {
    renderSection({}, { disabled: true });
    const row = screen.getByTestId("column-row-color");
    const buttons = Array.from(row.querySelectorAll("button"));
    const numBtn = buttons.find((b) => b.textContent === "Num");
    const catBtn = buttons.find((b) => b.textContent === "Cat");
    expect(numBtn).toBeDefined();
    expect(catBtn).toBeDefined();
    expect(numBtn).toBeDisabled();
    expect(catBtn).toBeDisabled();
  });

  it("does not call handlers when disabled and the controls are clicked", async () => {
    const { onExcludeToggle, onTypeChange } = renderSection(
      {},
      { disabled: true },
    );
    const row = screen.getByTestId("column-row-color");
    const checkbox = row.querySelector('[role="checkbox"]') as HTMLElement;
    fireEvent.click(checkbox);
    const numBtn = Array.from(row.querySelectorAll("button")).find(
      (b) => b.textContent === "Num",
    ) as HTMLElement;
    await userEvent.click(numBtn);
    expect(onExcludeToggle).not.toHaveBeenCalled();
    expect(onTypeChange).not.toHaveBeenCalled();
  });
});

describe("ColumnSettingsSection wide-DataFrame virtualization (PR-B2)", () => {
  function makeWide(n: number): ColumnInfo[] {
    const cols: ColumnInfo[] = [];
    for (let i = 0; i < n; i++) {
      cols.push({
        name: `f_${i.toString().padStart(5, "0")}`,
        dtype: "float64",
        unique_count: 100,
        suggested_type: "numeric",
        suggested_excluded: false,
      });
    }
    return cols;
  }

  function renderWide(cols: ColumnInfo[]) {
    render(
      <ColumnSettingsSection
        columns={cols}
        target="target_class"
        overrides={{}}
        columnFilter=""
        onColumnFilterChange={() => {}}
        expandedCol={null}
        colStats={{}}
        summary={{ ...SUMMARY, total: cols.length }}
        onExcludeToggle={vi.fn()}
        onTypeChange={vi.fn()}
        onColumnExpand={vi.fn()}
      />,
    );
  }

  it("uses the virtualized list path above the column threshold", () => {
    // happy-dom returns 0 for getBoundingClientRect on refs, so the
    // virtualizer will not actually mount any rows under test. Assert
    // on the structural marker (the dedicated scroll container + the
    // total-height spacer) instead, which still proves the virtual
    // branch was taken.
    renderWide(makeWide(5000));
    const scroll = document.querySelector(
      '[data-testid="column-virtual-scroll"]',
    );
    const spacer = document.querySelector(
      '[data-testid="column-virtual-spacer"]',
    );
    expect(scroll).not.toBeNull();
    expect(spacer).not.toBeNull();
  });

  it("preserves the total scroll height proportional to column count", () => {
    renderWide(makeWide(5000));
    const spacer = document.querySelector(
      '[data-testid="column-virtual-spacer"]',
    );
    expect(spacer).not.toBeNull();
    const totalHeight = (spacer as HTMLElement).style.height;
    expect(totalHeight).toMatch(/px$/);
    const px = Number.parseInt(totalHeight.replace("px", ""), 10);
    expect(px).toBeGreaterThan(28 * 1000);
  });

  it("does not switch on the virtualized list below the threshold", () => {
    renderWide(makeWide(50));
    const scroll = document.querySelector(
      '[data-testid="column-virtual-scroll"]',
    );
    expect(scroll).toBeNull();
  });

  it("renders the header row exactly once even at large column counts", () => {
    renderWide(makeWide(5000));
    expect(screen.getAllByText("Name").length).toBe(1);
  });
});

describe("ColumnSettingsSection bulk operations toolbar (PR-B2)", () => {
  function renderBulk(
    overrides: {
      columnFilter?: string;
      onBulkExcludeToggle?: (names: string[], checked: boolean) => void;
      onBulkTypeChange?: (
        names: string[],
        type: "numeric" | "categorical",
      ) => void;
    } = {},
  ) {
    const onBulkExcludeToggle = overrides.onBulkExcludeToggle ?? vi.fn();
    const onBulkTypeChange = overrides.onBulkTypeChange ?? vi.fn();
    render(
      <ColumnSettingsSection
        columns={COLUMNS}
        target="age"
        overrides={{}}
        columnFilter={overrides.columnFilter ?? ""}
        onColumnFilterChange={() => {}}
        expandedCol={null}
        colStats={{}}
        summary={SUMMARY}
        onExcludeToggle={vi.fn()}
        onTypeChange={vi.fn()}
        onColumnExpand={vi.fn()}
        onBulkExcludeToggle={onBulkExcludeToggle}
        onBulkTypeChange={onBulkTypeChange}
      />,
    );
    return { onBulkExcludeToggle, onBulkTypeChange };
  }

  it("does not render the toolbar when columnFilter is empty", () => {
    renderBulk({ columnFilter: "" });
    expect(screen.queryByTestId("column-bulk-toolbar")).toBeNull();
  });

  it("renders the toolbar when columnFilter matches at least one column", () => {
    renderBulk({ columnFilter: "co" }); // matches 'color'
    expect(screen.getByTestId("column-bulk-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("column-bulk-toolbar")).toHaveTextContent(/1/);
  });

  it("Exclude All calls onBulkExcludeToggle with the filtered names", () => {
    const { onBulkExcludeToggle } = renderBulk({ columnFilter: "co" });
    fireEvent.click(screen.getByRole("button", { name: /exclude filtered/i }));
    expect(onBulkExcludeToggle).toHaveBeenCalledWith(["color"], true);
  });

  it("Include All calls onBulkExcludeToggle with checked=false", () => {
    const { onBulkExcludeToggle } = renderBulk({ columnFilter: "co" });
    fireEvent.click(screen.getByRole("button", { name: /include filtered/i }));
    expect(onBulkExcludeToggle).toHaveBeenCalledWith(["color"], false);
  });

  it("Set Numeric calls onBulkTypeChange", () => {
    const { onBulkTypeChange } = renderBulk({ columnFilter: "co" });
    fireEvent.click(
      screen.getByRole("button", { name: /set filtered to numeric/i }),
    );
    expect(onBulkTypeChange).toHaveBeenCalledWith(["color"], "numeric");
  });

  it("Set Categorical calls onBulkTypeChange", () => {
    const { onBulkTypeChange } = renderBulk({ columnFilter: "co" });
    fireEvent.click(
      screen.getByRole("button", { name: /set filtered to categorical/i }),
    );
    expect(onBulkTypeChange).toHaveBeenCalledWith(["color"], "categorical");
  });

  it("toolbar still works when running without bulk callbacks (graceful)", () => {
    // Optional props — when omitted the toolbar simply hides.
    render(
      <ColumnSettingsSection
        columns={COLUMNS}
        target="age"
        overrides={{}}
        columnFilter="co"
        onColumnFilterChange={() => {}}
        expandedCol={null}
        colStats={{}}
        summary={SUMMARY}
        onExcludeToggle={vi.fn()}
        onTypeChange={vi.fn()}
        onColumnExpand={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("column-bulk-toolbar")).toBeNull();
  });
});
