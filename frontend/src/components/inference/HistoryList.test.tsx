import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InferenceRecord } from "@/api/inference";
import { HistoryList } from "./HistoryList";

// --- Test data factory ---

function makeRecord(overrides: Partial<InferenceRecord> = {}): InferenceRecord {
  return {
    inf_id: "inf-1",
    job_id: "job-1",
    data_ref: {
      source_type: "path",
      path: "/data/test.csv",
      filename: "test.csv",
      fingerprint: "abc",
      shape: [100, 5],
    },
    has_ground_truth: false,
    created_at: new Date().toISOString(),
    row_count: 100,
    warnings: [],
    ...overrides,
  };
}

// --- Tests ---

describe("HistoryList", () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when records are empty", () => {
    const { container } = render(
      <HistoryList records={[]} selectedInfId={null} onSelect={mockOnSelect} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders history heading when records exist", () => {
    render(
      <HistoryList
        records={[makeRecord()]}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("renders correct number labels (newest first)", () => {
    const records = [
      makeRecord({ inf_id: "inf-a" }),
      makeRecord({ inf_id: "inf-b" }),
      makeRecord({ inf_id: "inf-c" }),
    ];
    render(
      <HistoryList
        records={records}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );

    // First item = #3, second = #2, third = #1
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("displays row count for each record", () => {
    const records = [
      makeRecord({ inf_id: "inf-a", row_count: 50 }),
      makeRecord({ inf_id: "inf-b", row_count: 200 }),
    ];
    render(
      <HistoryList
        records={records}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );
    expect(screen.getByText("50 rows")).toBeInTheDocument();
    expect(screen.getByText("200 rows")).toBeInTheDocument();
  });

  it("shows GT badge for records with ground truth", () => {
    const records = [
      makeRecord({ inf_id: "inf-gt", has_ground_truth: true }),
      makeRecord({ inf_id: "inf-no-gt", has_ground_truth: false }),
    ];
    render(
      <HistoryList
        records={records}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );
    // Only one GT badge should appear
    const badges = screen.getAllByText("GT");
    expect(badges).toHaveLength(1);
  });

  it("applies selected styling to the active inference", () => {
    const records = [
      makeRecord({ inf_id: "inf-selected" }),
      makeRecord({ inf_id: "inf-other" }),
    ];
    render(
      <HistoryList
        records={records}
        selectedInfId="inf-selected"
        onSelect={mockOnSelect}
      />,
    );

    const buttons = screen.getAllByRole("button");
    // First button (inf-selected) should have bg-accent class
    expect(buttons[0].className).toContain("bg-accent");
    // Second button should not
    expect(buttons[1].className).not.toContain("bg-accent text-accent");
  });

  it("calls onSelect with inf_id when item is clicked", async () => {
    const user = userEvent.setup();
    const records = [makeRecord({ inf_id: "inf-click-me" })];
    render(
      <HistoryList
        records={records}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );

    await user.click(screen.getByRole("button"));
    expect(mockOnSelect).toHaveBeenCalledWith("inf-click-me");
  });

  it("shows relative time for each record", () => {
    // Create a record from 30 seconds ago → should show "now"
    const recentIso = new Date(Date.now() - 30_000).toISOString();
    const records = [
      makeRecord({ inf_id: "inf-recent", created_at: recentIso }),
    ];
    render(
      <HistoryList
        records={records}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );
    expect(screen.getByText("now")).toBeInTheDocument();
  });

  it("shows minutes for records a few minutes old", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const records = [makeRecord({ created_at: fiveMinAgo })];
    render(
      <HistoryList
        records={records}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );
    expect(screen.getByText("5m")).toBeInTheDocument();
  });

  it("shows hours for records a few hours old", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const records = [makeRecord({ created_at: twoHoursAgo })];
    render(
      <HistoryList
        records={records}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );
    expect(screen.getByText("2h")).toBeInTheDocument();
  });

  it("shows days for records older than 24 hours", () => {
    const threeDaysAgo = new Date(
      Date.now() - 3 * 24 * 60 * 60_000,
    ).toISOString();
    const records = [makeRecord({ created_at: threeDaysAgo })];
    render(
      <HistoryList
        records={records}
        selectedInfId={null}
        onSelect={mockOnSelect}
      />,
    );
    expect(screen.getByText("3d")).toBeInTheDocument();
  });
});
