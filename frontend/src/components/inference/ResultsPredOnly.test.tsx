import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/helpers";

vi.mock("@/api/inference", () => ({
  fetchInferenceComparison: vi.fn().mockResolvedValue({
    current: {},
    other: {},
  }),
  fetchInferencePlot: vi.fn().mockResolvedValue(null),
  fetchInferenceShapPlot: vi.fn().mockResolvedValue(null),
}));

vi.mock("./PredictionsTable", () => ({
  PredictionsTable: ({ infId, jobId }: { infId: string; jobId: string }) => (
    <div data-testid="predictions-table">
      PredictionsTable {infId} {jobId}
    </div>
  ),
}));

vi.mock("@/components/workspace/PlotlyChart", () => ({
  PlotlyChart: ({ plotlyJson }: { plotlyJson: string }) => (
    <div data-testid="plotly-chart">PlotlyChart</div>
  ),
}));

import type { InferenceRecord } from "@/api/inference";
import { ResultsPredOnly } from "./ResultsPredOnly";

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
    has_ground_truth: false,
    created_at: "2025-01-01T00:00:00Z",
    row_count: 100,
    warnings: [],
    ...overrides,
  };
}

afterEach(cleanup);

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

  it("renders Prediction Distribution heading", () => {
    const record = makeRecord();
    renderWithQuery(
      <ResultsPredOnly
        record={record}
        infNumber={1}
        jobLabel="job"
        history={[record]}
      />,
    );

    expect(screen.getByText("Prediction Distribution")).toBeInTheDocument();
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
});
