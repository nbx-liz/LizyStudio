import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoundHistoryTable } from "./RoundHistoryTable";
import type { TuneRound } from "./types";

const baseRound: TuneRound = {
  round: 1,
  n_trials: 50,
  best_score_before: null,
  best_score_after: 0.8,
  expanded_dims: [],
};

describe("RoundHistoryTable", () => {
  it("returns null when rounds is empty", () => {
    const { container } = render(<RoundHistoryTable rounds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per round", () => {
    const rounds: TuneRound[] = [
      { ...baseRound, round: 1, best_score_after: 0.8 },
      {
        ...baseRound,
        round: 2,
        best_score_before: 0.8,
        best_score_after: 0.85,
      },
    ];
    render(<RoundHistoryTable rounds={rounds} />);
    expect(
      screen.getByRole("heading", { name: /round history/i }),
    ).toBeInTheDocument();
    // 1 header + 2 data rows
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("formats best score to 4 decimals", () => {
    render(
      <RoundHistoryTable
        rounds={[{ ...baseRound, best_score_after: 0.834567 }]}
      />,
    );
    expect(screen.getByText("0.8346")).toBeInTheDocument();
  });

  it("shows em-dash improvement for first round (no before)", () => {
    render(
      <RoundHistoryTable
        rounds={[
          { ...baseRound, best_score_before: null, best_score_after: 0.9 },
        ]}
      />,
    );
    // em-dash appears in both improvement and expanded-dims cells
    const dashes = screen.getAllByText("\u2014");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("colors delta emerald for improvement", () => {
    render(
      <RoundHistoryTable
        rounds={[
          {
            ...baseRound,
            round: 2,
            best_score_before: 0.8,
            best_score_after: 0.85,
          },
        ]}
      />,
    );
    const cell = screen.getByText("+0.0500");
    expect(cell.className).toContain("emerald");
  });

  it("uses neutral color when delta is exactly zero", () => {
    render(
      <RoundHistoryTable
        rounds={[
          {
            ...baseRound,
            round: 2,
            best_score_before: 0.85,
            best_score_after: 0.85,
          },
        ]}
      />,
    );
    // delta === 0 has no sign prefix
    const cell = screen.getByText("0.0000");
    expect(cell.className).toContain("muted-foreground");
    expect(cell.className).not.toContain("emerald");
    expect(cell.className).not.toContain("rose");
  });

  it("colors delta rose for regression", () => {
    render(
      <RoundHistoryTable
        rounds={[
          {
            ...baseRound,
            round: 2,
            best_score_before: 0.9,
            best_score_after: 0.8,
          },
        ]}
      />,
    );
    const cell = screen.getByText("-0.1000");
    expect(cell.className).toContain("rose");
  });

  it("marks the last row with aria-current", () => {
    const rounds: TuneRound[] = [
      { ...baseRound, round: 1, best_score_after: 0.8 },
      {
        ...baseRound,
        round: 2,
        best_score_before: 0.8,
        best_score_after: 0.85,
      },
      {
        ...baseRound,
        round: 3,
        best_score_before: 0.85,
        best_score_after: 0.87,
      },
    ];
    render(<RoundHistoryTable rounds={rounds} />);
    const rows = screen.getAllByRole("row");
    // rows[0] is header; rows[1..3] are rounds 1..3
    expect(rows[3]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).not.toHaveAttribute("aria-current");
  });

  it("collapses expanded dims when more than 3", () => {
    render(
      <RoundHistoryTable
        rounds={[
          {
            ...baseRound,
            expanded_dims: ["a", "b", "c", "d", "e"],
          },
        ]}
      />,
    );
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  });

  it("hides expanded dims column on narrow viewports (class only)", () => {
    render(
      <RoundHistoryTable rounds={[{ ...baseRound, expanded_dims: ["foo"] }]} />,
    );
    const header = screen.getByRole("columnheader", { name: /expanded dims/i });
    expect(header.className).toContain("hidden");
    expect(header.className).toContain("sm:table-cell");
  });

  it("renders literal Greek delta in the improvement header", () => {
    render(<RoundHistoryTable rounds={[baseRound]} />);
    // Regression guard: ensure we render Δ, not a backslash-u escape sequence
    expect(
      screen.getByRole("columnheader", { name: /improvement \(Δ\)/i }),
    ).toBeInTheDocument();
  });
});
