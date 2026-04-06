import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobDetail } from "@/api/types";
import { renderWithQuery } from "@/test/helpers";
import { CompletedContent } from "./CompletedContent";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@/api/jobs", () => ({
  fetchJobPlots: vi.fn().mockResolvedValue([]),
  fetchJobPlot: vi.fn().mockResolvedValue({ plotly_json: "{}" }),
  fetchJobImportance: vi.fn().mockResolvedValue({}),
  fetchJobImportanceKinds: vi.fn().mockResolvedValue([]),
  fetchJobSplitSummary: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/workspace/PlotlyChart", () => ({
  PlotlyChart: ({ plotlyJson }: { plotlyJson: string }) => (
    <div data-testid="plotly-chart">{plotlyJson}</div>
  ),
}));

vi.mock("@/components/workspace/SegmentGroup", () => ({
  SegmentGroup: ({
    options,
    value,
    onChange,
  }: {
    options: string[];
    value: string;
    onChange: (v: string) => void;
    labels?: Record<string, string>;
  }) => (
    <div data-testid="segment-group">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          data-active={o === value}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFitJob(overrides?: Partial<JobDetail>): JobDetail {
  return {
    job_id: "j1",
    job_type: "fit",
    status: "completed",
    backend_name: "lizyml",
    model_name: "lgb",
    config: {},
    data_ref: {
      source_type: "path",
      path: "/data/train.csv",
      filename: "train.csv",
      fingerprint: "abc",
      shape: [100, 5],
    },
    created_at: "2025-01-01T00:00:00Z",
    completed_at: "2025-01-01T00:01:00Z",
    error: null,
    primary_score: 0.95,
    fit_result: {
      metrics: {
        raw: {
          if_mean: { auc: 0.95 },
          oof: { auc: 0.9 },
          oof_std: { auc: 0.01 },
        },
      },
      fold_count: 5,
      params: [{ n_estimators: 100, learning_rate: 0.1 }],
    },
    tune_result: null,
    model_path: "/models/j1",
    ...overrides,
  };
}

function makeTuneJob(overrides?: Partial<JobDetail>): JobDetail {
  return {
    ...makeFitJob(),
    job_type: "tune",
    tune_result: {
      best_params: { n_estimators: 200, learning_rate: 0.05 },
      best_score: 0.96,
      trials: [
        { trial: 1, score: 0.95, n_estimators: 100 },
        { trial: 2, score: 0.96, n_estimators: 200 },
      ],
      metric_name: "auc",
      direction: "maximize",
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// KPI Cards (H-0050)
// ---------------------------------------------------------------------------
describe("CompletedContent — KPI cards (H-0050)", () => {
  it("renders KPI cards with metrics", () => {
    const job = makeFitJob();
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByTestId("kpi-cards")).toBeInTheDocument();
    expect(screen.getByText("auc")).toBeInTheDocument();
    expect(screen.getByText("0.9500")).toBeInTheDocument();
    expect(screen.getByText("0.9000")).toBeInTheDocument();
  });

  it("shows Std in KPI cards when fold_count > 1", () => {
    const job = makeFitJob();
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("Std")).toBeInTheDocument();
    expect(screen.getByText("0.0100")).toBeInTheDocument();
  });

  it("hides Std in KPI cards when fold_count is 1", () => {
    const job = makeFitJob({
      fit_result: {
        metrics: {
          raw: { if_mean: { auc: 0.9 }, oof: { auc: 0.85 }, oof_std: {} },
        },
        fold_count: 1,
        params: [],
      },
    });
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.queryByText("Std")).not.toBeInTheDocument();
  });

  it("renders View Details accordion for score table", () => {
    const job = makeFitJob();
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("View Details")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tune result rendering
// ---------------------------------------------------------------------------
describe("CompletedContent — tune result", () => {
  it("renders Best Params table", () => {
    const job = makeTuneJob();
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("Best Params")).toBeInTheDocument();
    expect(screen.getByText("n_estimators")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("learning_rate")).toBeInTheDocument();
    expect(screen.getByText("0.05")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// No fit result
// ---------------------------------------------------------------------------
describe("CompletedContent — no results", () => {
  it("does not render KPI cards when fit_result is null", () => {
    const job = makeFitJob({ fit_result: null });
    renderWithQuery(
      <CompletedContent job={job} selectedPlot="" onSelectPlot={vi.fn()} />,
    );
    expect(screen.queryByTestId("kpi-cards")).not.toBeInTheDocument();
    expect(screen.queryByText("View Details")).not.toBeInTheDocument();
  });
});

describe("CompletedContent — tune job", () => {
  it("renders TuneTrialsSection for tune result with tuning plot", () => {
    const job = makeTuneJob();
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("Best Params")).toBeInTheDocument();
    expect(screen.getByText("auc")).toBeInTheDocument();
  });

  it("does not render TuneTrialsSection when tune_result is null", () => {
    const job = makeFitJob({ tune_result: null });
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.queryByText("Best Params")).not.toBeInTheDocument();
  });
});

describe("CompletedContent — annotateMetric", () => {
  it("annotates precision_at_k metric with k value from config", () => {
    const job = makeFitJob({
      config: { evaluation: { precision_at_k: 5 } },
      fit_result: {
        metrics: {
          raw: {
            if_mean: { precision_at_k: 0.8 },
            oof: { precision_at_k: 0.75 },
            oof_std: { precision_at_k: 0.02 },
          },
        },
        fold_count: 5,
        params: [],
      },
    });
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("precision_at_k@5")).toBeInTheDocument();
  });

  it("shows precision_at_k without annotation when k is not a number", () => {
    const job = makeFitJob({
      config: { evaluation: {} },
      fit_result: {
        metrics: {
          raw: {
            if_mean: { precision_at_k: 0.8 },
            oof: { precision_at_k: 0.75 },
            oof_std: {},
          },
        },
        fold_count: 1,
        params: [],
      },
    });
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("precision_at_k")).toBeInTheDocument();
  });
});

describe("CompletedContent — multiple metrics", () => {
  it("renders multiple metric KPI cards", () => {
    const job = makeFitJob({
      fit_result: {
        metrics: {
          raw: {
            if_mean: { auc: 0.95, f1: 0.88 },
            oof: { auc: 0.9, f1: 0.85 },
            oof_std: { auc: 0.01, f1: 0.02 },
          },
        },
        fold_count: 5,
        params: [],
      },
    });
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("auc")).toBeInTheDocument();
    expect(screen.getByText("f1")).toBeInTheDocument();
  });
});
