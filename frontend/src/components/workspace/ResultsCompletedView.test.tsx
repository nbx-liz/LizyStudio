import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeJob, renderWithQuery } from "@/test/helpers";
import { ResultsCompletedView } from "./ResultsCompletedView";

// Capture PlotSection props across renders so we can assert on lcMetric /
// availableEvalMetrics regardless of SegmentGroup's implementation.
const plotSectionCalls: Record<string, unknown>[] = [];

vi.mock("@/api/jobs", () => ({
  fetchJobPlots: vi.fn().mockResolvedValue(["learning-curve", "importance"]),
  fetchJobPlot: vi
    .fn()
    .mockResolvedValue({ plotly_json: '{"data":[],"layout":{}}' }),
  fetchJobImportance: vi.fn().mockResolvedValue({}),
  fetchJobImportanceKinds: vi.fn().mockResolvedValue([]),
  fetchJobLearningCurveMetrics: vi.fn(),
  fetchJobSplitSummary: vi.fn().mockResolvedValue([]),
}));

vi.mock("./PlotSection", () => ({
  PlotSection: (props: Record<string, unknown>) => {
    plotSectionCalls.push(props);
    return <div data-testid="plot-section" />;
  },
}));

vi.mock("./FoldDetailsSection", () => ({
  FoldDetailsSection: () => <div data-testid="fold-details" />,
}));

vi.mock("./TuneTrialsSection", () => ({
  TuneTrialsSection: () => <div data-testid="tune-trials" />,
  TrialResultsAccordionItem: () => <div data-testid="trial-results" />,
}));

async function renderView(lcMetrics: string[]) {
  plotSectionCalls.length = 0;
  const jobs = await import("@/api/jobs");
  (
    jobs.fetchJobLearningCurveMetrics as ReturnType<typeof vi.fn>
  ).mockResolvedValue(lcMetrics);

  const job = makeJob({
    job_id: "job_test",
    config: {
      model: {
        name: "LightGBM",
        params: { metric: ["auc", "binary_logloss"] },
      },
      evaluation: { metrics: ["f1"] },
    },
    fit_result: {
      metrics: { f1: { oos: 0.42 } },
      fold_count: 3,
      params: [],
    } as unknown as import("@/api/types").FitResult,
  });

  renderWithQuery(
    <ResultsCompletedView
      job={job}
      headerLabel="Test"
      selectedPlot="learning-curve"
      onSelectPlot={vi.fn()}
    />,
  );
  return job;
}

function latestProps(): Record<string, unknown> {
  return plotSectionCalls[plotSectionCalls.length - 1];
}

afterEach(() => {
  cleanup();
  plotSectionCalls.length = 0;
});

describe("ResultsCompletedView — learning curve metrics filter", () => {
  it("uses the backend-provided metric list, not job.config.model.params.metric", async () => {
    // Backend reports only "f1" is actually in eval_history even though
    // config.model.params.metric = ["auc","binary_logloss"] (H-0061 bug).
    await renderView(["f1"]);

    await waitFor(() => {
      expect(screen.getByTestId("plot-section")).toBeInTheDocument();
    });
    await waitFor(() => {
      const props = latestProps();
      expect(props.availableEvalMetrics).toEqual(["f1"]);
    });
  });

  it("initializes lcMetric to the first backend metric when multiple are available", async () => {
    await renderView(["auc", "f1"]);

    await waitFor(() => {
      const props = latestProps();
      expect(props.availableEvalMetrics).toEqual(["auc", "f1"]);
      expect(props.lcMetric).toBe("auc");
    });
  });

  it("does not select an lcMetric when only one is available", async () => {
    await renderView(["f1"]);

    await waitFor(() => {
      const props = latestProps();
      expect(props.availableEvalMetrics).toEqual(["f1"]);
      expect(props.lcMetric).toBeNull();
    });
  });

  it("surfaces LC fetch errors via isError instead of silently resetting state", async () => {
    const jobs = await import("@/api/jobs");
    (jobs.fetchJobPlot as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id: string, plot: string) => {
        if (plot === "learning-curve") {
          throw new Error("backend boom");
        }
        return { plotly_json: "{}" };
      },
    );

    await renderView(["auc", "f1"]);

    await waitFor(() => {
      const props = latestProps();
      expect(props.isError).toBe(true);
      // The initial auto-selected metric MUST NOT flip back to null on error.
      expect(props.lcMetric).toBe("auc");
    });

    // Restore default so subsequent tests aren't affected.
    (jobs.fetchJobPlot as ReturnType<typeof vi.fn>).mockResolvedValue({
      plotly_json: '{"data":[],"layout":{}}',
    });
  });
});
