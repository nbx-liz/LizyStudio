import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "@/api/types";
import { CvSection, type CvState, INITIAL_CV_STATE } from "./CvSection";

// --- Mock child components ---

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
});
