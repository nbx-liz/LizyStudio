import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/helpers";

vi.mock("@/api/inference", () => ({
  fetchInferenceMetrics: vi.fn().mockResolvedValue({}),
  fetchInferencePlot: vi.fn().mockResolvedValue(null),
  fetchInferenceShapPlot: vi.fn().mockResolvedValue(null),
}));

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

vi.mock("./ScoreTable", () => ({
  ScoreTable: () => <div data-testid="score-table">ScoreTable</div>,
}));

vi.mock("@/components/workspace/PlotlyChart", () => ({
  PlotlyChart: ({ plotlyJson: _plotlyJson }: { plotlyJson: string }) => (
    <div data-testid="plotly-chart">PlotlyChart</div>
  ),
}));

import type { InferenceRecord } from "@/api/inference";
import {
  fetchInferenceMetrics,
  fetchInferencePlot,
  fetchInferenceShapPlot,
} from "@/api/inference";
import { fetchJobPlots } from "@/api/jobs";
import { ResultsWithGT } from "./ResultsWithGT";

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
    has_ground_truth: true,
    created_at: "2025-01-01T00:00:00Z",
    row_count: 200,
    warnings: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("ResultsWithGT", () => {
  it("renders header with inference number and job label", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={5}
        jobLabel="xgboost-model"
        targetCol="target"
      />,
    );

    expect(screen.getByText("Inf #5 -- xgboost-model")).toBeInTheDocument();
  });

  it("renders row count and ground truth column name", () => {
    const record = makeRecord({ row_count: 500 });
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="y_label"
      />,
    );

    expect(
      screen.getByText("500 rows -- Ground Truth: 'y_label'"),
    ).toBeInTheDocument();
  });

  it("renders Prediction Distribution accordion trigger", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    expect(screen.getByText("Prediction Distribution")).toBeInTheDocument();
  });

  it("renders Predictions accordion trigger", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    expect(screen.getByText("Predictions")).toBeInTheDocument();
  });

  it("does not render Warnings accordion when no warnings exist", () => {
    const record = makeRecord({ warnings: [] });
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
  });

  it("renders Warnings accordion when warnings are present", () => {
    const record = makeRecord({
      warnings: ["Data drift detected", "Feature mismatch"],
    });
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    expect(screen.getByText("Warnings")).toBeInTheDocument();
  });

  it("does not render Score section when metrics lack three-column structure", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    // Score heading should not appear since mocked metrics is {}
    expect(screen.queryByText("Score")).not.toBeInTheDocument();
    expect(screen.queryByTestId("score-table")).not.toBeInTheDocument();
  });

  it("renders with custom row count", () => {
    const record = makeRecord({ row_count: 750 });
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={2}
        jobLabel="model"
        targetCol="y"
      />,
    );

    expect(
      screen.getByText("750 rows -- Ground Truth: 'y'"),
    ).toBeInTheDocument();
  });

  it("renders with zero-length warnings", () => {
    const record = makeRecord({ warnings: [] });
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    // Should render without crashing, no Warnings section
    expect(screen.getByText("Predictions")).toBeInTheDocument();
    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
  });

  it("renders with multiple warnings", () => {
    const record = makeRecord({
      warnings: ["Warn 1", "Warn 2", "Warn 3"],
    });
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    expect(screen.getByText("Warnings")).toBeInTheDocument();
  });

  // Lines 89-102: Score section renders when metrics has three-column structure
  it("renders Score section when metrics has inf/is/oos structure", async () => {
    vi.mocked(fetchInferenceMetrics).mockResolvedValueOnce({
      inf: { accuracy: 0.9 },
      is: { accuracy: 0.88 },
      oos: { accuracy: 0.85 },
    } as never);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Score")).toBeInTheDocument();
      expect(screen.getByTestId("score-table")).toBeInTheDocument();
    });
  });

  // Lines 105-131: Plots section renders when plots array is non-empty
  it("renders Plots section with select when plots are available", async () => {
    vi.mocked(fetchJobPlots).mockResolvedValueOnce([
      "confusion-matrix",
      "roc-curve",
      "learning-curve",
    ]);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Plots")).toBeInTheDocument();
    });
  });

  // Lines 117-122: Plots section filters out learning-curve, tuning, importance
  it("filters out learning-curve, tuning, importance from plot select", async () => {
    vi.mocked(fetchJobPlots).mockResolvedValueOnce([
      "learning-curve",
      "tuning",
      "importance",
      "confusion-matrix",
    ]);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Plots")).toBeInTheDocument();
    });

    // learning-curve, tuning, importance should not appear as select items
    expect(screen.queryByText("learning curve")).not.toBeInTheDocument();
    expect(screen.queryByText("tuning")).not.toBeInTheDocument();
    expect(screen.queryByText("importance")).not.toBeInTheDocument();
  });

  // Lines 129: plotData renders PlotlyChart when available
  it("renders PlotlyChart when plot data is loaded", async () => {
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["confusion-matrix"]);
    vi.mocked(fetchInferencePlot).mockResolvedValue({
      plotly_json: '{"data":[]}',
    } as never);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Plots")).toBeInTheDocument();
      expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
    });
  });

  // Lines 169-187: PredDistributionPlot shows loading then chart
  it("renders prediction distribution loading state initially", async () => {
    // Keep fetchInferencePlot pending so isLoading stays true briefly
    let resolve: (v: unknown) => void;
    const pending = new Promise((res) => {
      resolve = res;
    });
    vi.mocked(fetchInferencePlot).mockImplementation((_, __, plotName) => {
      if (plotName === "prediction-distribution") return pending as never;
      return Promise.resolve(null) as never;
    });

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    // The accordion is collapsed by default; PredDistributionPlot still mounts
    // and issues the query. Since the promise is pending, isLoading is true.
    // We verify the component renders without crashing here.
    expect(screen.getByText("Prediction Distribution")).toBeInTheDocument();

    // Resolve to avoid hanging
    resolve!(null);
  });

  // Lines 129 + auto-select useEffect: PlotlyChart renders in Plots section
  // when fetchJobPlots returns plots and fetchInferencePlot returns data
  it("renders PlotlyChart in Plots section when plot data resolves", async () => {
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["confusion-matrix"]);
    vi.mocked(fetchInferencePlot).mockResolvedValue({
      plotly_json: '{"data":[]}',
    } as never);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
    });
  });

  // Lines 191-214: ShapAccordionItem renders when shap data is available
  it("renders SHAP Summary accordion when shap data resolves", async () => {
    // Issue #355: SHAP fetch is gated on available_plots; test must
    // surface "shap-summary" through fetchJobPlots for the gate to open.
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["shap-summary"]);
    vi.mocked(fetchInferenceShapPlot).mockResolvedValueOnce({
      plotly_json: '{"data":[]}',
    } as never);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("SHAP Summary")).toBeInTheDocument();
    });
  });

  // Lines 198: ShapAccordionItem returns null when no data and not loading
  it("does not render SHAP Summary accordion when shap data is null", async () => {
    vi.mocked(fetchInferenceShapPlot).mockResolvedValueOnce(null as never);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    await waitFor(() => {
      // Wait for query to settle
      expect(screen.queryByText("SHAP Summary")).not.toBeInTheDocument();
    });
  });

  // Lines 204-206: ShapAccordionItem shows loading text while fetching
  it("renders SHAP Summary loading state while shap is pending", async () => {
    // Issue #355: gate must be open for the SHAP fetch to fire.
    vi.mocked(fetchJobPlots).mockResolvedValueOnce(["shap-summary"]);
    let resolveShap: (v: unknown) => void;
    const pendingShap = new Promise((res) => {
      resolveShap = res;
    });
    vi.mocked(fetchInferenceShapPlot).mockReturnValueOnce(pendingShap as never);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    // While loading, the accordion item should be present (isLoading = true)
    await waitFor(() => {
      expect(screen.getByText("SHAP Summary")).toBeInTheDocument();
    });

    // Resolve to avoid hanging
    resolveShap!(null);
  });

  // Lines 176-187: PredDistributionPlot — open accordion to trigger content render
  it("renders loading text in prediction distribution while query is pending", async () => {
    const user = userEvent.setup();
    let resolveDist: (v: unknown) => void;
    const pendingDist = new Promise((res) => {
      resolveDist = res;
    });
    vi.mocked(fetchInferencePlot).mockImplementation((_, __, plotName) => {
      if (plotName === "prediction-distribution") return pendingDist as never;
      return Promise.resolve(null) as never;
    });

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    // Open the Prediction Distribution accordion
    await user.click(screen.getByText("Prediction Distribution"));

    await waitFor(() => {
      expect(screen.getByText("Loading distribution...")).toBeInTheDocument();
    });

    resolveDist!(null);
  });

  it("renders PlotlyChart in prediction distribution after data resolves", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchInferencePlot).mockResolvedValue({
      plotly_json: '{"data":[]}',
    } as never);

    const record = makeRecord();
    renderWithQuery(
      <ResultsWithGT
        record={record}
        infNumber={1}
        jobLabel="job"
        targetCol="target"
      />,
    );

    // Open the Prediction Distribution accordion to mount PredDistributionPlot content
    await user.click(screen.getByText("Prediction Distribution"));

    await waitFor(() => {
      expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
    });
  });
});
