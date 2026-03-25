import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobDetail } from "@/api/types";
import { CompletedContent } from "./CompletedContent";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@/api/jobs", () => ({
  fetchJobPlots: vi.fn().mockResolvedValue([]),
  fetchJobPlot: vi.fn().mockResolvedValue({ plotly_json: "{}" }),
  fetchJobImportance: vi.fn().mockResolvedValue({}),
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
function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

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
    error_code: null,
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
// Fit result rendering
// ---------------------------------------------------------------------------
describe("CompletedContent — fit result", () => {
  it("renders score table with metrics", () => {
    const job = makeFitJob();
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("auc")).toBeInTheDocument();
    expect(screen.getByText("0.9500")).toBeInTheDocument();
    expect(screen.getByText("0.9000")).toBeInTheDocument();
  });

  it("shows OOS Std column when fold_count > 1", () => {
    const job = makeFitJob();
    renderWithQuery(
      <CompletedContent
        job={job}
        selectedPlot="learning-curve"
        onSelectPlot={vi.fn()}
      />,
    );
    expect(screen.getByText("OOS Std")).toBeInTheDocument();
    expect(screen.getByText("0.0100")).toBeInTheDocument();
  });

  it("hides OOS Std column when fold_count is 1", () => {
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
    expect(screen.queryByText("OOS Std")).not.toBeInTheDocument();
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
  it("does not render Score section when fit_result is null", () => {
    const job = makeFitJob({ fit_result: null });
    renderWithQuery(
      <CompletedContent job={job} selectedPlot="" onSelectPlot={vi.fn()} />,
    );
    expect(screen.queryByText("Score")).not.toBeInTheDocument();
  });
});
