import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobDetail, PlotResponse, TuneResult } from "@/api/types";
import { Accordion } from "@/components/ui/accordion";
import {
  TrialResultsAccordionItem,
  TuneTrialsSection,
} from "./TuneTrialsSection";

vi.mock("./PlotlyChart", () => ({
  PlotlyChart: ({ plotlyJson }: { plotlyJson: string }) => (
    <div data-testid="plotly-chart">{plotlyJson}</div>
  ),
}));

function makeJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    job_id: "job-1",
    job_type: "tune",
    status: "completed",
    backend_name: "lizyml",
    model_name: "lgbm",
    config: {
      model: {
        name: "lgbm",
        params: { learning_rate: 0.1 },
      },
    },
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
    error: null,
    primary_score: 0.95,
    fit_result: null,
    tune_result: null,
    parent_job_id: null,
    ...overrides,
  };
}

function makeTuneResult(overrides: Partial<TuneResult> = {}): TuneResult {
  return {
    best_params: { learning_rate: 0.05, num_leaves: 64 },
    best_score: 0.95,
    trials: [
      { trial: 0, score: 0.9, learning_rate: 0.1 },
      { trial: 1, score: 0.95, learning_rate: 0.05 },
      { trial: 2, score: 0.85, learning_rate: 0.2 },
    ],
    metric_name: "auc",
    direction: "maximize",
    ...overrides,
  };
}

describe("TuneTrialsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 'Best Params' heading", () => {
    render(
      <TuneTrialsSection
        tuneResult={makeTuneResult()}
        tuningPlot={undefined}
        job={makeJob()}
      />,
    );
    expect(screen.getByText("Best Params")).toBeInTheDocument();
  });

  it("renders best params table with key-value pairs", () => {
    render(
      <TuneTrialsSection
        tuneResult={makeTuneResult()}
        tuningPlot={undefined}
        job={makeJob()}
      />,
    );
    expect(screen.getByText("learning_rate")).toBeInTheDocument();
    expect(screen.getByText("0.0500")).toBeInTheDocument();
    expect(screen.getByText("num_leaves")).toBeInTheDocument();
    expect(screen.getByText("64.0000")).toBeInTheDocument();
  });

  it("shows 'Apply to Fit' button when onApplyToFit is provided", () => {
    render(
      <TuneTrialsSection
        tuneResult={makeTuneResult()}
        tuningPlot={undefined}
        job={makeJob()}
        onApplyToFit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Apply to Fit" }),
    ).toBeInTheDocument();
  });

  it("hides 'Apply to Fit' when onApplyToFit is undefined", () => {
    render(
      <TuneTrialsSection
        tuneResult={makeTuneResult()}
        tuningPlot={undefined}
        job={makeJob()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Apply to Fit" }),
    ).not.toBeInTheDocument();
  });

  it("clicking 'Apply to Fit' calls onApplyToFit with merged config", () => {
    const onApplyToFit = vi.fn();
    const job = makeJob({
      config: {
        model: { name: "lgbm", params: { learning_rate: 0.1 } },
        cv: { folds: 5 },
      },
    });
    const tuneResult = makeTuneResult({
      best_params: { learning_rate: 0.05, num_leaves: 64 },
    });

    render(
      <TuneTrialsSection
        tuneResult={tuneResult}
        tuningPlot={undefined}
        job={job}
        onApplyToFit={onApplyToFit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply to Fit" }));

    expect(onApplyToFit).toHaveBeenCalledOnce();
    const calledWith = onApplyToFit.mock.calls[0][0];
    expect(calledWith).toEqual({
      model: {
        name: "lgbm",
        params: { learning_rate: 0.05, num_leaves: 64 },
      },
      cv: { folds: 5 },
    });
  });

  it("strips tuning section from config when applying to fit", () => {
    const onApplyToFit = vi.fn();
    const job = makeJob({
      config: {
        model: { name: "lgbm", params: { learning_rate: 0.1 } },
        tuning: {
          optuna: { space: { learning_rate: { low: 0.01, high: 0.3 } } },
        },
      },
    });
    const tuneResult = makeTuneResult({
      best_params: { learning_rate: 0.05 },
    });

    render(
      <TuneTrialsSection
        tuneResult={tuneResult}
        tuningPlot={undefined}
        job={job}
        onApplyToFit={onApplyToFit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply to Fit" }));

    const calledWith = onApplyToFit.mock.calls[0][0];
    expect(calledWith).not.toHaveProperty("tuning");
    expect(calledWith.model.params).toEqual({ learning_rate: 0.05 });
  });

  it("renders optimization history plot when tuningPlot is provided", () => {
    const tuningPlot: PlotResponse = { plotly_json: '{"data":[]}' };
    render(
      <TuneTrialsSection
        tuneResult={makeTuneResult()}
        tuningPlot={tuningPlot}
        job={makeJob()}
      />,
    );
    expect(screen.getByText("Optimization History")).toBeInTheDocument();
    expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
  });

  it("does not render optimization history when tuningPlot is undefined", () => {
    render(
      <TuneTrialsSection
        tuneResult={makeTuneResult()}
        tuningPlot={undefined}
        job={makeJob()}
      />,
    );
    expect(screen.queryByText("Optimization History")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plotly-chart")).not.toBeInTheDocument();
  });
});

describe("TrialResultsAccordionItem", () => {
  afterEach(() => {
    cleanup();
  });

  it("returns null when trials is empty", () => {
    const tuneResult = makeTuneResult({ trials: [] });
    const { container } = render(
      <Accordion type="single" collapsible defaultValue="trials">
        <TrialResultsAccordionItem tuneResult={tuneResult} />
      </Accordion>,
    );
    expect(container.querySelector("[data-state]")).toBeNull();
  });

  it("renders 'Trial Results' heading with trials", () => {
    render(
      <Accordion type="single" collapsible defaultValue="trials">
        <TrialResultsAccordionItem tuneResult={makeTuneResult()} />
      </Accordion>,
    );
    expect(screen.getByText("Trial Results")).toBeInTheDocument();
  });

  it("sorts trials by score (maximize: descending)", () => {
    const tuneResult = makeTuneResult({
      direction: "maximize",
      best_score: 0.95,
      trials: [
        { trial: 0, score: 0.85 },
        { trial: 1, score: 0.95 },
        { trial: 2, score: 0.9 },
      ],
    });
    render(
      <Accordion type="single" collapsible defaultValue="trials">
        <TrialResultsAccordionItem tuneResult={tuneResult} />
      </Accordion>,
    );

    const cells = screen.getAllByRole("cell");
    // Sorted descending: 0.95, 0.9, 0.85
    // Each row has 2 cells (trial, score). Score cells are at indices 1, 3, 5.
    expect(cells[1].textContent).toBe("0.9500");
    expect(cells[3].textContent).toBe("0.9000");
    expect(cells[5].textContent).toBe("0.8500");
  });

  it("sorts trials by score (minimize: ascending)", () => {
    const tuneResult = makeTuneResult({
      direction: "minimize",
      best_score: 0.1,
      trials: [
        { trial: 0, score: 0.3 },
        { trial: 1, score: 0.1 },
        { trial: 2, score: 0.2 },
      ],
    });
    render(
      <Accordion type="single" collapsible defaultValue="trials">
        <TrialResultsAccordionItem tuneResult={tuneResult} />
      </Accordion>,
    );

    const cells = screen.getAllByRole("cell");
    // Sorted ascending: 0.1, 0.2, 0.3
    expect(cells[1].textContent).toBe("0.1000");
    expect(cells[3].textContent).toBe("0.2000");
    expect(cells[5].textContent).toBe("0.3000");
  });

  it("highlights best trial row with star", () => {
    const tuneResult = makeTuneResult({
      direction: "maximize",
      best_score: 0.95,
      trials: [
        { trial: 0, score: 0.85 },
        { trial: 1, score: 0.95 },
        { trial: 2, score: 0.9 },
      ],
    });
    render(
      <Accordion type="single" collapsible defaultValue="trials">
        <TrialResultsAccordionItem tuneResult={tuneResult} />
      </Accordion>,
    );

    // The best trial (score=0.95, trial=1) should have a star prefix
    expect(screen.getByText(/★ 1/)).toBeInTheDocument();
  });
});
