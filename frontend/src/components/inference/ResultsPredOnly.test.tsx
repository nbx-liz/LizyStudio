import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/helpers";

vi.mock("@/api/inference", () => ({
  fetchInferenceComparison: vi.fn().mockResolvedValue({
    current: {},
    other: {},
  }),
  fetchInferencePlot: vi.fn().mockResolvedValue(null),
  fetchInferenceShapPlot: vi.fn().mockResolvedValue(null),
}));

// Issue #355: SHAP fetch is gated on the available_plots returned by
// /api/jobs/{id}/plots. The mock defaults to "no SHAP available" so
// the gate stays closed; SHAP-positive tests opt in below.
vi.mock("@/api/jobs", () => ({
  fetchJobPlots: vi.fn().mockResolvedValue([]),
}));

vi.mock("./PredictionsTable", () => ({
  PredictionsTable: ({ infId, jobId }: { infId: string; jobId: string }) => (
    <div data-testid="predictions-table">
      PredictionsTable {infId} {jobId}
    </div>
  ),
}));

vi.mock("@/components/workspace/PlotlyChart", () => ({
  PlotlyChart: ({ plotlyJson: _plotlyJson }: { plotlyJson: string }) => (
    <div data-testid="plotly-chart">PlotlyChart</div>
  ),
}));

import {
  fetchInferenceComparison,
  fetchInferencePlot,
  fetchInferenceShapPlot,
  type InferenceRecord,
} from "@/api/inference";
import { fetchJobPlots } from "@/api/jobs";
import { ResultsPredOnly } from "./ResultsPredOnly";

function makeRecord(overrides: Partial<InferenceRecord> = {}): InferenceRecord {
  return {
    inf_id: "inf-001",
    job_id: "job-001",
    data_ref: {
      source_type: "upload",
      path: "/data/test.csv",
      filename: "test.csv",
      fingerprint: "abc123",
      shape: [100, 5],
    },
    has_ground_truth: false,
    created_at: "2025-01-01T00:00:00Z",
    row_count: 100,
    warnings: [],
    ...overrides,
  };
}

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(fetchInferencePlot).mockResolvedValue(null as never);
  vi.mocked(fetchInferenceShapPlot).mockResolvedValue(null as never);
  vi.mocked(fetchInferenceComparison).mockResolvedValue({
    current: {},
    other: {},
  });
  vi.mocked(fetchJobPlots).mockResolvedValue([]);
});

describe("ResultsPredOnly", () => {
  it("renders header with inference number and job label", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={3}
        jobLabel="my-model"
        history={[record]}
      />,
    );

    expect(screen.getByText("Inf #3 -- my-model")).toBeInTheDocument();
  });

  it("renders row count and Prediction Only label", () => {
    const record = makeRecord({ row_count: 250 });
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="test-job"
        history={[record]}
      />,
    );

    expect(screen.getByText("250 rows -- Prediction Only")).toBeInTheDocument();
  });

  it("renders Predictions heading and PredictionsTable", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    expect(screen.getByText("Predictions")).toBeInTheDocument();
    expect(screen.getByTestId("predictions-table")).toBeInTheDocument();
  });

  // Issue #370: the section is gated on the backend's available plot
  // list — only renders when ``probability-histogram`` is advertised.
  it("renders Prediction Distribution heading when probability-histogram is available", async () => {
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["probability-histogram"]);
    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Prediction Distribution")).toBeInTheDocument();
    });
  });

  it("hides Prediction Distribution heading when probability-histogram is unavailable (e.g. regression)", async () => {
    vi.mocked(fetchInferencePlot).mockClear();
    vi.mocked(fetchJobPlots).mockResolvedValueOnce([
      "learning-curve",
      "residuals",
    ]);
    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    // Give react-query time to settle the available-plots fetch.
    await new Promise((r) => setTimeout(r, 30));
    expect(
      screen.queryByText("Prediction Distribution"),
    ).not.toBeInTheDocument();
    // The frontend MUST NOT have requested the distribution plot
    // (no ``prediction-distribution`` 404 in DevTools).
    expect(fetchInferencePlot).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "probability-histogram",
    );
    expect(fetchInferencePlot).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "prediction-distribution",
    );
  });

  it("does not render Comparison section when no other records exist", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    expect(screen.queryByText("Comparison")).not.toBeInTheDocument();
  });

  it("renders Comparison section when other records exist in history", () => {
    const record = makeRecord({ inf_id: "inf-001" });
    const otherRecord = makeRecord({ inf_id: "inf-002" });
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={2}
        jobLabel="job"
        history={[otherRecord, record]}
      />,
    );

    expect(screen.getByText("Comparison")).toBeInTheDocument();
    expect(screen.getByText("Select past inference")).toBeInTheDocument();
  });

  it("renders Warnings accordion when warnings are present", () => {
    const record = makeRecord({
      warnings: ["Missing values detected", "Low variance columns"],
    });
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    expect(screen.getByText("Warnings")).toBeInTheDocument();
  });

  it("does not render Warnings accordion when no warnings", () => {
    const record = makeRecord({ warnings: [] });
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
  });

  it("renders with custom data ref shape", () => {
    const record = makeRecord({
      row_count: 50,
      data_ref: {
        source_type: "upload",
        path: "/data/test.csv",
        filename: "my_dataset.csv",
        fingerprint: "abc",
        shape: [50, 3],
      },
    });
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    expect(screen.getByText("50 rows -- Prediction Only")).toBeInTheDocument();
  });

  it("renders with empty history (only current record)", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[]}
      />,
    );

    // Should render without crashing
    expect(screen.getByText("Predictions")).toBeInTheDocument();
    // No comparison section since history is empty
    expect(screen.queryByText("Comparison")).not.toBeInTheDocument();
  });

  // --- ComparisonTable / formatStatName coverage (lines 140-173) ---

  it("renders ComparisonTable with stat rows after selecting comparison inference", async () => {
    vi.mocked(fetchInferenceComparison).mockResolvedValueOnce({
      current: { mean: 0.5, std: 0.1, positive_pct: 0.3 },
      other: { mean: 0.6, std: 0.2, positive_pct: 0.4 },
    });

    const record = makeRecord({ inf_id: "inf-001" });
    const otherRecord = makeRecord({ inf_id: "inf-002" });
    const history = [otherRecord, record];

    const { getByRole } = renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={2}
        jobLabel="job"
        history={history}
      />,
    );

    // Open the Select dropdown
    const trigger = getByRole("combobox");
    trigger.click();

    // Radix UI renders option text split across spans; use role="option"
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    options[0].click();

    // Wait for ComparisonTable rows to appear
    await waitFor(() => {
      expect(screen.getByText("Mean")).toBeInTheDocument();
    });

    expect(screen.getByText("Std")).toBeInTheDocument();
    // formatStatName maps "positive_pct" -> "Positive %"
    expect(screen.getByText("Positive %")).toBeInTheDocument();
  });

  it("formatStatName capitalises generic stat keys", async () => {
    vi.mocked(fetchInferenceComparison).mockResolvedValueOnce({
      current: { median: 0.5 },
      other: { median: 0.6 },
    });

    const record = makeRecord({ inf_id: "inf-001" });
    const other = makeRecord({ inf_id: "inf-002" });
    const history = [other, record];

    const { getByRole } = renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={2}
        jobLabel="job"
        history={history}
      />,
    );

    const trigger = getByRole("combobox");
    trigger.click();

    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    options[0].click();

    await waitFor(() => {
      expect(screen.getByText("Median")).toBeInTheDocument();
    });
  });

  // --- PredDistributionPlot conditional branches (lines 194-195) ---

  it("renders PlotlyChart inside PredDistributionPlot when data is available", async () => {
    // Issue #370: section now gates on the backend's available plot
    // list, so the test must advertise ``probability-histogram``
    // before the inference plot fetch fires.
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["probability-histogram"]);
    vi.mocked(fetchInferencePlot).mockResolvedValueOnce({
      plotly_json: '{"data":[]}',
    });

    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
    });
    // Issue #370: the request MUST go to ``probability-histogram``,
    // not the legacy non-existent ``prediction-distribution`` key.
    expect(fetchInferencePlot).toHaveBeenCalledWith(
      record.inf_id,
      record.job_id,
      "probability-histogram",
    );
  });

  it("renders nothing for PredDistributionPlot when data is null", () => {
    // fetchInferencePlot already defaults to null in the module mock
    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    // No PlotlyChart should appear (no shap data either)
    expect(screen.queryByTestId("plotly-chart")).not.toBeInTheDocument();
  });

  // --- ShapAndWarningsAccordion coverage (lines 199-250) ---

  it("renders SHAP Summary accordion when shap data is available", async () => {
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["shap-summary"]);
    vi.mocked(fetchInferenceShapPlot).mockResolvedValueOnce({
      plotly_json: '{"data":[]}',
    });

    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("SHAP Summary")).toBeInTheDocument();
    });
  });

  it("renders SHAP Summary accordion trigger while loading", async () => {
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["shap-summary"]);
    // Use a never-resolving promise to hold the loading state
    vi.mocked(fetchInferenceShapPlot).mockReturnValueOnce(
      new Promise(() => {}),
    );

    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    // hasShap is true while loading, so the accordion appears immediately
    await waitFor(() => {
      expect(screen.getByText("SHAP Summary")).toBeInTheDocument();
    });
  });

  it("renders both SHAP Summary and Warnings accordions together", async () => {
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["shap-summary"]);
    vi.mocked(fetchInferenceShapPlot).mockResolvedValueOnce({
      plotly_json: '{"data":[]}',
    });

    const record = makeRecord({ warnings: ["Some warning"] });
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("SHAP Summary")).toBeInTheDocument();
    });
    expect(screen.getByText("Warnings")).toBeInTheDocument();
  });

  it("renders only Warnings accordion when shap data is null and warnings present", async () => {
    // fetchInferenceShapPlot returns null (default mock) — hasShap becomes false after load
    const record = makeRecord({ warnings: ["Low variance"] });
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    // Warnings accordion should be visible
    expect(screen.getByText("Warnings")).toBeInTheDocument();
    // Wait for any in-flight queries to settle, then confirm SHAP is absent
    await waitFor(() => {
      expect(screen.queryByText("SHAP Summary")).not.toBeInTheDocument();
    });
  });

  it("renders nothing for ShapAndWarningsAccordion when no shap and no warnings", async () => {
    const record = makeRecord({ warnings: [] });
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    // Wait for queries to settle so we are past the isLoading phase
    await waitFor(() => {
      expect(screen.queryByText("SHAP Summary")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
  });
});
