import { cleanup, render, screen } from "@testing-library/react";
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
  PlotlyChart: ({ plotlyJson }: { plotlyJson: string }) => (
    <div data-testid="plotly-chart">PlotlyChart</div>
  ),
}));

import type { InferenceRecord } from "@/api/inference";
import { ResultsWithGT } from "./ResultsWithGT";

function makeRecord(overrides: Partial<InferenceRecord> = {}): InferenceRecord {
  return {
    inf_id: "inf-001",
    job_id: "job-001",
    data_ref: {
      source_type: "file",
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
});
