import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "@/api/types";
import {
  CvSection,
  type CvState,
  INITIAL_BLOCKED_STATE,
  INITIAL_CV_STATE,
} from "./CvSection";

const cols: ColumnInfo[] = [
  {
    name: "ts",
    dtype: "object",
    unique_count: 12,
    suggested_type: "categorical",
    suggested_excluded: false,
    exclude_reason: null,
  },
];

function makeCv(overrides: Partial<CvState> = {}): CvState {
  return { ...INITIAL_CV_STATE, ...overrides };
}

describe("CvSection running lock (P-0089 / Issue #279)", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables strategy segment buttons when disabled=true", () => {
    render(
      <CvSection
        cv={makeCv()}
        onChange={vi.fn()}
        uiSchema={
          {
            capabilities: { cv_strategies: ["kfold", "stratified_kfold"] },
          } as never
        }
        nonExcludedCols={cols}
        disabled
      />,
    );
    const segmentButtons = screen.getAllByRole("button");
    // At least one strategy segment button should exist; all of them
    // must be disabled while the workspace is locked.
    expect(segmentButtons.length).toBeGreaterThan(0);
    for (const btn of segmentButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it("disables Folds NumberInput when disabled=true", () => {
    render(
      <CvSection
        cv={makeCv({ strategy: "kfold" })}
        onChange={vi.fn()}
        uiSchema={
          {
            capabilities: {
              cv_strategies: ["kfold"],
              cv_strategy_fields: { kfold: ["n_splits", "random_state"] },
            },
          } as never
        }
        nonExcludedCols={cols}
        disabled
      />,
    );
    // NumberInput renders as Decrement/Input/Increment. Asserting on the
    // accessible Decrement / Increment buttons gives a stable check that
    // the disabled prop reached the underlying control.
    const decrements = screen.getAllByRole("button", { name: /decrement/i });
    const increments = screen.getAllByRole("button", { name: /increment/i });
    expect(decrements.length).toBeGreaterThan(0);
    expect(increments.length).toBeGreaterThan(0);
    for (const btn of [...decrements, ...increments]) {
      expect(btn).toBeDisabled();
    }
  });

  it("propagates disabled to BlockedGroupKFoldEditor", () => {
    render(
      <CvSection
        cv={makeCv({ strategy: "blocked_group_kfold" })}
        onChange={vi.fn()}
        uiSchema={
          {
            capabilities: {
              cv_strategies: ["kfold", "blocked_group_kfold"],
              cv_strategy_fields: { blocked_group_kfold: ["time_col"] },
            },
          } as never
        }
        nonExcludedCols={cols}
        blocked={INITIAL_BLOCKED_STATE}
        onBlockedChange={vi.fn()}
        disabled
      />,
    );
    const editor = screen.getByTestId("blocked-group-kfold-editor");
    // The editor wrapper is a <fieldset disabled> when locked.
    expect(editor.tagName).toBe("FIELDSET");
    expect(editor).toBeDisabled();
  });

  it("does not disable controls when disabled is omitted", () => {
    render(
      <CvSection
        cv={makeCv({ strategy: "kfold" })}
        onChange={vi.fn()}
        uiSchema={
          {
            capabilities: {
              cv_strategies: ["kfold"],
              cv_strategy_fields: { kfold: ["n_splits"] },
            },
          } as never
        }
        nonExcludedCols={cols}
      />,
    );
    const segments = screen.getAllByRole("button");
    expect(segments.length).toBeGreaterThan(0);
    for (const btn of segments) {
      expect(btn).not.toBeDisabled();
    }
  });
});

describe("CvSection running lock — sanity guards", () => {
  it("BlockedGroupKFoldEditor wrapper passes through testid", () => {
    render(
      <CvSection
        cv={makeCv({ strategy: "blocked_group_kfold" })}
        onChange={vi.fn()}
        uiSchema={
          {
            capabilities: {
              cv_strategies: ["blocked_group_kfold"],
              cv_strategy_fields: { blocked_group_kfold: ["time_col"] },
            },
          } as never
        }
        nonExcludedCols={cols}
        blocked={INITIAL_BLOCKED_STATE}
        onBlockedChange={vi.fn()}
      />,
    );
    const editor = screen.getByTestId("blocked-group-kfold-editor");
    expect(editor).toBeInTheDocument();
    // When unlocked, nested form controls inside the fieldset must
    // remain enabled.
    expect(editor).not.toBeDisabled();
    // Editor renders columns as Select options in the real component;
    // we just verify the wrapper does not strip its descendants.
    expect(within(editor).getAllByText(/Block/i).length).toBeGreaterThan(0);
  });
});
