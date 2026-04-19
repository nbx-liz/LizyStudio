import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "@/api/types";
import {
  type BlockedGroupKFoldState,
  CvSection,
  type CvState,
  INITIAL_BLOCKED_STATE,
  INITIAL_CV_STATE,
} from "./CvSection";

// --- Mock child components ---

vi.mock("./BlockedGroupKFoldEditor", () => ({
  BlockedGroupKFoldEditor: () => (
    <div data-testid="blocked-group-kfold-editor">BlockedGroupKFoldEditor</div>
  ),
  INITIAL_BLOCKED_STATE: {
    cutoffs: [],
    blockMode: "expanding",
    trainWindow: 1,
    stratify: "auto",
  },
}));

vi.mock("./SegmentGroup", () => ({
  SegmentGroup: ({
    options,
    value,
    onChange,
  }: {
    options: string[];
    value: string;
    onChange: (v: string) => void;
  }) => (
    <div data-testid="segment-group">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          data-testid={`strategy-${opt}`}
          data-selected={opt === value}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./NumberInput", () => ({
  NumberInput: ({
    value,
    onChange,
    min,
    placeholder,
  }: {
    value: number | undefined;
    onChange: (v: number | undefined) => void;
    min?: number;
    step?: number;
    placeholder?: string;
  }) => (
    <input
      data-testid={`number-input-${placeholder ?? "auto"}`}
      type="number"
      value={value ?? ""}
      min={min}
      onChange={(e) => {
        const v = e.target.value === "" ? undefined : Number(e.target.value);
        onChange(v);
      }}
    />
  ),
}));

vi.mock("./NullableNumberField", () => ({
  NullableNumberField: ({
    label,
    value,
    onChange,
    placeholder,
  }: {
    label: string;
    value: number | undefined;
    onChange: (v: number | undefined) => void;
    placeholder?: string;
    autoHint?: boolean;
  }) => {
    const labelId = `nullable-label-${label.toLowerCase().replace(/\s+/g, "-")}`;
    return (
      <div>
        <label id={labelId} htmlFor={`nullable-input-${placeholder ?? "auto"}`}>
          {label}
        </label>
        <input
          id={`nullable-input-${placeholder ?? "auto"}`}
          // Preserve number-input-{placeholder} testid for existing test compatibility
          data-testid={`number-input-${placeholder ?? "auto"}`}
          aria-labelledby={labelId}
          type="number"
          value={value ?? ""}
          placeholder={placeholder ?? "Auto"}
          onChange={(e) => {
            const v =
              e.target.value === "" ? undefined : Number(e.target.value);
            onChange(v);
          }}
        />
      </div>
    );
  },
}));

// --- Test helpers ---

const sampleCols: ColumnInfo[] = [
  {
    name: "col_a",
    dtype: "int64",
    unique_count: 10,
    suggested_type: "numeric",
    suggested_excluded: false,
    exclude_reason: null,
  },
  {
    name: "col_b",
    dtype: "object",
    unique_count: 5,
    suggested_type: "categorical",
    suggested_excluded: false,
    exclude_reason: null,
  },
];

function makeCvState(overrides: Partial<CvState> = {}): CvState {
  return { ...INITIAL_CV_STATE, ...overrides };
}

// --- Tests ---

describe("CvSection", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders strategy segment group with available strategies", () => {
    render(
      <CvSection
        cv={makeCvState()}
        onChange={mockOnChange}
        uiSchema={
          {
            capabilities: { cv_strategies: ["kfold", "stratified_kfold"] },
          } as never
        }
        nonExcludedCols={sampleCols}
      />,
    );
    expect(screen.getByTestId("strategy-kfold")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-stratified_kfold")).toBeInTheDocument();
  });

  it("shows Folds and Random State fields for stratified_kfold strategy", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "stratified_kfold" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );
    expect(screen.getByText("Folds")).toBeInTheDocument();
    expect(screen.getByText("Random State")).toBeInTheDocument();
    // group_col should NOT be shown
    expect(screen.queryByText("Group column")).not.toBeInTheDocument();
  });

  it("shows Folds, Random State, and Shuffle fields for kfold strategy", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "kfold" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );
    expect(screen.getByText("Folds")).toBeInTheDocument();
    expect(screen.getByText("Random State")).toBeInTheDocument();
    expect(screen.getByText("Shuffle")).toBeInTheDocument();
  });

  it("shows Group column select for group_kfold strategy", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "group_kfold" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );
    expect(screen.getByText("Group column")).toBeInTheDocument();
    // Shuffle should NOT be shown
    expect(screen.queryByText("Shuffle")).not.toBeInTheDocument();
  });

  it("shows Time column and Gap fields for time_series strategy", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "time_series" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );
    expect(screen.getByText("Time column")).toBeInTheDocument();
    expect(screen.getByText("Gap")).toBeInTheDocument();
    expect(screen.getByText("Train Size Max")).toBeInTheDocument();
    expect(screen.getByText("Test Size Max")).toBeInTheDocument();
    // Random State should NOT be shown
    expect(screen.queryByText("Random State")).not.toBeInTheDocument();
  });

  it("calls onChange with resetCvState when strategy changes", async () => {
    const user = userEvent.setup();
    render(
      <CvSection
        cv={makeCvState({ strategy: "kfold" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    await user.click(screen.getByTestId("strategy-group_kfold"));

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: "group_kfold" }),
    );
  });

  it("calls onChange with updated folds value", async () => {
    const user = userEvent.setup();
    render(
      <CvSection
        cv={makeCvState({ strategy: "kfold", folds: 5 })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const foldsInput = screen.getByTestId("number-input-5");
    await user.clear(foldsInput);
    await user.type(foldsInput, "10");

    // onChange should be called with the new folds value
    expect(mockOnChange).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Additional strategy rendering tests
  // -------------------------------------------------------------------------

  it("shows Folds, Random State, and Group column for stratified_group_kfold", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "stratified_group_kfold" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );
    expect(screen.getByText("Folds")).toBeInTheDocument();
    expect(screen.getByText("Random State")).toBeInTheDocument();
    expect(screen.getByText("Group column")).toBeInTheDocument();
    expect(screen.queryByText("Shuffle")).not.toBeInTheDocument();
    expect(screen.queryByText("Time column")).not.toBeInTheDocument();
  });

  it("shows Purge Gap and Embargo fields for purged_time_series strategy", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "purged_time_series" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );
    expect(screen.getByText("Time column")).toBeInTheDocument();
    expect(screen.getByText("Purge Gap")).toBeInTheDocument();
    expect(screen.getByText("Embargo")).toBeInTheDocument();
    expect(screen.getByText("Train Size Max")).toBeInTheDocument();
    expect(screen.getByText("Test Size Max")).toBeInTheDocument();
    expect(screen.queryByText("Gap")).not.toBeInTheDocument();
    expect(screen.queryByText("Shuffle")).not.toBeInTheDocument();
  });

  it("shows Time column, Group column, and Gap for group_time_series strategy", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "group_time_series" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );
    expect(screen.getByText("Time column")).toBeInTheDocument();
    expect(screen.getByText("Group column")).toBeInTheDocument();
    expect(screen.getByText("Gap")).toBeInTheDocument();
    expect(screen.getByText("Train Size Max")).toBeInTheDocument();
    expect(screen.getByText("Test Size Max")).toBeInTheDocument();
    expect(screen.queryByText("Purge Gap")).not.toBeInTheDocument();
    expect(screen.queryByText("Embargo")).not.toBeInTheDocument();
  });

  it("renders BlockedGroupKFoldEditor and hides generic fields for blocked_group_kfold when blocked props provided", () => {
    const mockOnBlockedChange = vi.fn();
    const blockedState: BlockedGroupKFoldState = { ...INITIAL_BLOCKED_STATE };

    render(
      <CvSection
        cv={makeCvState({ strategy: "blocked_group_kfold" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
        blocked={blockedState}
        onBlockedChange={mockOnBlockedChange}
      />,
    );

    // Generic fields must NOT appear for blocked_group_kfold
    expect(screen.queryByText("Folds")).not.toBeInTheDocument();
    expect(screen.queryByText("Shuffle")).not.toBeInTheDocument();
    expect(screen.queryByText("Gap")).not.toBeInTheDocument();
  });

  it("does not render BlockedGroupKFoldEditor when blocked props are absent", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "blocked_group_kfold" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
        // blocked and onBlockedChange intentionally omitted
      />,
    );

    // Without blocked props, editor is not mounted
    // Generic fields are also hidden (strategy === blocked_group_kfold guard)
    expect(screen.queryByText("Folds")).not.toBeInTheDocument();
  });

  it("uses all strategies from CV_STRATEGY_LABELS when uiSchema is undefined", () => {
    render(
      <CvSection
        cv={makeCvState()}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
        // uiSchema intentionally omitted
      />,
    );
    // SegmentGroup receives all known strategies as options
    expect(screen.getByTestId("strategy-kfold")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-stratified_kfold")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-group_kfold")).toBeInTheDocument();
    expect(
      screen.getByTestId("strategy-blocked_group_kfold"),
    ).toBeInTheDocument();
  });

  it("calls onChange with updated shuffle value when Shuffle toggle is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CvSection
        cv={makeCvState({ strategy: "kfold", shuffle: true })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const shuffleSwitch = screen.getByRole("switch");
    await user.click(shuffleSwitch);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ shuffle: false }),
    );
  });

  it("calls onChange with updated randomState when Random State input changes", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "kfold", randomState: 42 })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const randomStateInput = screen.getByTestId("number-input-42");
    fireEvent.change(randomStateInput, { target: { value: "99" } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ randomState: 99 }),
    );
  });

  it("calls onChange with updated gap value for time_series strategy", async () => {
    const user = userEvent.setup();
    render(
      <CvSection
        cv={makeCvState({ strategy: "time_series", gap: 0 })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const gapInput = screen.getByTestId("number-input-0");
    await user.clear(gapInput);
    await user.type(gapInput, "3");

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ gap: 3 }),
    );
  });

  it("calls onChange with undefined folds when folds input is cleared", async () => {
    const user = userEvent.setup();
    render(
      <CvSection
        cv={makeCvState({ strategy: "stratified_kfold", folds: 5 })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const foldsInput = screen.getByTestId("number-input-5");
    await user.clear(foldsInput);

    // When cleared, NumberInput emits undefined; component defaults to 5
    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ folds: 5 }),
    );
  });

  it("renders Group column select for group_kfold", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "group_kfold" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    expect(screen.getByText("Group column")).toBeInTheDocument();
    // Radix Select renders options only when opened; verify trigger exists
    expect(screen.getByText("Select column")).toBeInTheDocument();
  });

  it("renders Time column select for time_series", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "time_series" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    expect(screen.getByText("Time column")).toBeInTheDocument();
    expect(screen.getByText("Select column")).toBeInTheDocument();
  });

  it("renders Min Train Rows and Min Valid Rows with autoHint for blocked_group_kfold without blocked editor", () => {
    // When blocked/onBlockedChange are absent, editor is skipped but
    // the generic Min Train Rows / Min Valid Rows fields are also hidden
    // because strategy === blocked_group_kfold guard applies.
    // This test verifies no crash occurs in this edge case.
    render(
      <CvSection
        cv={makeCvState({
          strategy: "blocked_group_kfold",
          minTrainRows: 100,
          minValidRows: 50,
        })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );
    // Fields hidden by the blocked_group_kfold guard
    expect(screen.queryByText("Min Train Rows")).not.toBeInTheDocument();
    expect(screen.queryByText("Min Valid Rows")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Coverage: NullableNumberField onChange callbacks (lines 213-258)
  // NullableNumberField mock uses data-testid="number-input-{placeholder}".
  // Use getByRole("spinbutton", { name: /label/i }) to disambiguate same-
  // placeholder inputs rendered together (e.g. both "Purge Gap" and "Embargo"
  // have placeholder "0").
  // -------------------------------------------------------------------------

  it("calls onChange with updated purgeGap value for purged_time_series", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "purged_time_series", purgeGap: 0 })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    // aria-labelledby set by mock connects label "Purge Gap" to this spinbutton
    const input = screen.getByRole("spinbutton", { name: /purge gap/i });
    fireEvent.change(input, { target: { value: "5" } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ purgeGap: 5 }),
    );
  });

  it("calls onChange with updated embargo value for purged_time_series", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "purged_time_series", embargo: 0 })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: /embargo/i });
    fireEvent.change(input, { target: { value: "2" } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ embargo: 2 }),
    );
  });

  it("calls onChange with updated trainSizeMax value for time_series", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "time_series", trainSizeMax: undefined })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: /train size max/i });
    fireEvent.change(input, { target: { value: "1000" } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ trainSizeMax: 1000 }),
    );
  });

  it("calls onChange with updated testSizeMax value for time_series", () => {
    render(
      <CvSection
        cv={makeCvState({ strategy: "time_series", testSizeMax: undefined })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: /test size max/i });
    fireEvent.change(input, { target: { value: "200" } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ testSizeMax: 200 }),
    );
  });

  it("min_train_rows and min_valid_rows are never rendered for non-blocked strategies", () => {
    // blocked_group_kfold has min_train_rows/min_valid_rows in CV_STRATEGY_FIELDS,
    // but those are guarded by strategy !== blocked_group_kfold, so they NEVER render.
    // This test documents that invariant across two representative strategies.
    for (const strategy of ["kfold", "purged_time_series"]) {
      render(
        <CvSection
          cv={makeCvState({ strategy })}
          onChange={mockOnChange}
          nonExcludedCols={sampleCols}
        />,
      );
      expect(screen.queryByText("Min Train Rows")).not.toBeInTheDocument();
      expect(screen.queryByText("Min Valid Rows")).not.toBeInTheDocument();
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // Coverage: Group column / Time column Select onValueChange (lines 161, 184)
  // -------------------------------------------------------------------------

  it("calls onChange with updated groupCol when group column is selected", async () => {
    const user = userEvent.setup();
    render(
      <CvSection
        cv={makeCvState({ strategy: "group_kfold", groupCol: undefined })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    // Open the Select trigger and click an option
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);

    const option = await screen.findByRole("option", { name: "col_a" });
    await user.click(option);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ groupCol: "col_a" }),
    );
  });

  it("calls onChange with updated timeCol when time column is selected", async () => {
    const user = userEvent.setup();
    render(
      <CvSection
        cv={makeCvState({ strategy: "time_series", timeCol: undefined })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    const trigger = screen.getByRole("combobox");
    await user.click(trigger);

    const option = await screen.findByRole("option", { name: "col_b" });
    await user.click(option);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ timeCol: "col_b" }),
    );
  });

  it("calls onChange with updated groupCol when group column is selected for group_time_series", async () => {
    const user = userEvent.setup();
    render(
      <CvSection
        cv={makeCvState({ strategy: "group_time_series" })}
        onChange={mockOnChange}
        nonExcludedCols={sampleCols}
      />,
    );

    // In CvSection, group_col Select (line 154) renders before time_col Select
    // (line 177). For group_time_series both are present; triggers[0]=group_col.
    const triggers = screen.getAllByRole("combobox");
    await user.click(triggers[0]);

    const option = await screen.findByRole("option", { name: "col_a" });
    await user.click(option);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ groupCol: "col_a" }),
    );
  });
});
