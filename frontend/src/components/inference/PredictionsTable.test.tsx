import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/helpers";
import { PredictionsTable } from "./PredictionsTable";

vi.mock("@/api/inference", () => ({
  fetchInferencePredictions: vi.fn(),
  getInferenceDownloadUrl: vi
    .fn()
    .mockReturnValue("/api/inference/inf1/download?job_id=j1"),
}));

import { fetchInferencePredictions } from "@/api/inference";

describe("PredictionsTable", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when data is not yet loaded", () => {
    const { container } = renderWithQuery(
      <PredictionsTable infId="inf1" jobId="j1" />,
    );
    // Before the query resolves, the component returns null
    expect(container.innerHTML).toBe("");
  });

  it("renders table with columns and rows when data is loaded", async () => {
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["id", "prediction"],
      data: [
        { id: 1, prediction: 0.8765 },
        { id: 2, prediction: 0.1234 },
      ],
      total_rows: 2,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    // Wait for table headers to appear
    expect(await screen.findByText("id")).toBeInTheDocument();
    expect(screen.getByText("prediction")).toBeInTheDocument();

    // Check formatted cell values
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("0.8765")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("0.1234")).toBeInTheDocument();
  });

  it("shows row count info", async () => {
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["x"],
      data: [{ x: 1 }],
      total_rows: 1,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    expect(await screen.findByText(/Showing 1/)).toBeInTheDocument();
    expect(screen.getByText(/of 1/)).toBeInTheDocument();
  });

  it("renders Download CSV button", async () => {
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["x"],
      data: [{ x: 1 }],
      total_rows: 1,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    expect(
      await screen.findByRole("button", { name: /download csv/i }),
    ).toBeInTheDocument();
  });

  it("shows pagination controls when multiple pages exist", async () => {
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["x"],
      data: Array.from({ length: 50 }, (_, i) => ({ x: i })),
      total_rows: 100,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("does not show pagination controls when only one page", async () => {
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["x"],
      data: [{ x: 1 }],
      total_rows: 1,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    await screen.findByText("x"); // wait for render
    expect(screen.queryByText(/Page/)).not.toBeInTheDocument();
  });

  it("formats integer and float cell values correctly", async () => {
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["int_col", "float_col", "str_col"],
      data: [{ int_col: 42, float_col: Math.PI, str_col: "hello" }],
      total_rows: 1,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    // Integer stays as-is
    expect(await screen.findByText("42")).toBeInTheDocument();
    // Float gets toFixed(4)
    expect(screen.getByText("3.1416")).toBeInTheDocument();
    // String rendered as-is
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("navigates to next page when next button is clicked", async () => {
    // Page 1: return 50 rows, total 100
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["x"],
      data: Array.from({ length: 50 }, (_, i) => ({ x: i })),
      total_rows: 100,
    });
    // Page 2: return 50 rows, total 100
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["x"],
      data: Array.from({ length: 50 }, (_, i) => ({ x: i + 50 })),
      total_rows: 100,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    // Wait for page 1
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();

    // Click next button (ChevronRight button — it is not disabled on page 1)
    const buttons = screen.getAllByRole("button");
    const nextButton = buttons[buttons.length - 1];
    expect(nextButton).not.toBeDisabled();
    fireEvent.click(nextButton);

    // Now showing page 2
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("navigates back to previous page when prev button is clicked", async () => {
    // Page 1 initial load
    vi.mocked(fetchInferencePredictions).mockResolvedValue({
      columns: ["x"],
      data: Array.from({ length: 50 }, (_, i) => ({ x: i })),
      total_rows: 100,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    // Advance to page 2
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    const buttonsP1 = screen.getAllByRole("button");
    // Download CSV button is also a button; pagination buttons are at index 1 (prev) and 2 (next)
    const nextBtn = buttonsP1[buttonsP1.length - 1];
    fireEvent.click(nextBtn);

    // Confirm page 2 is shown
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();

    // Click prev button (second button overall: [0]=Download CSV, [1]=Prev, [2]=Next)
    const buttonsP2 = screen.getAllByRole("button");
    const prevButton = buttonsP2[1];
    expect(prevButton).not.toBeDisabled();
    fireEvent.click(prevButton);

    // Back to page 1
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("renders empty string for null, undefined, and empty-string cell values", async () => {
    vi.mocked(fetchInferencePredictions).mockResolvedValueOnce({
      columns: ["a", "b", "c"],
      data: [{ a: null, b: undefined, c: "" }],
      total_rows: 1,
    });

    renderWithQuery(<PredictionsTable infId="inf1" jobId="j1" />);

    // Wait for render; all three cells should be empty strings
    await screen.findByText("a"); // header
    const cells = screen.getAllByRole("cell");
    for (const cell of cells) {
      expect(cell.textContent).toBe("");
    }
  });
});
