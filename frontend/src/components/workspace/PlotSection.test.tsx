import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlotResponse } from "@/api/types";
import { PlotSection } from "./PlotSection";

vi.mock("./PlotlyChart", () => ({
  PlotlyChart: ({
    plotlyJson,
    height,
  }: {
    plotlyJson: string;
    height?: number;
  }) => (
    <div data-testid="plotly-chart" data-height={height}>
      {plotlyJson}
    </div>
  ),
}));

describe("PlotSection", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    plots: ["learning-curve", "roc-curve", "importance"],
    selectedPlot: "roc-curve",
    onSelectPlot: vi.fn(),
    plotData: undefined as PlotResponse | undefined,
    learningCurve: undefined as PlotResponse | undefined,
    isLoading: false,
    isError: false,
  };

  it('returns null when plots array only contains "tuning"', () => {
    const { container } = render(
      <PlotSection {...defaultProps} plots={["tuning"]} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders Plots heading when plots are available", () => {
    render(<PlotSection {...defaultProps} />);
    expect(screen.getByText("Plots")).toBeInTheDocument();
  });

  it('filters out "tuning" from plot options', () => {
    render(
      <PlotSection
        {...defaultProps}
        plots={["tuning", "roc-curve", "importance"]}
      />,
    );
    expect(screen.queryByText("tuning")).toBeNull();
    expect(screen.getByText("ROC")).toBeInTheDocument();
    expect(screen.getByText("Importance")).toBeInTheDocument();
  });

  it("shows loading message when isLoading is true", () => {
    render(<PlotSection {...defaultProps} isLoading={true} />);
    expect(screen.getByText("Loading plot...")).toBeInTheDocument();
  });

  it("shows error message when isError is true and not loading", () => {
    render(<PlotSection {...defaultProps} isError={true} isLoading={false} />);
    expect(
      screen.getByText(
        "Failed to load plot. This plot may not be available for this model.",
      ),
    ).toBeInTheDocument();
  });

  it("renders PlotlyChart with plotData when not loading or error", () => {
    const plotData: PlotResponse = { plotly_json: '{"data":[]}' };
    render(<PlotSection {...defaultProps} plotData={plotData} />);
    const chart = screen.getByTestId("plotly-chart");
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveTextContent('{"data":[]}');
  });

  it('uses learningCurve data when selectedPlot is "learning-curve"', () => {
    const plotData: PlotResponse = { plotly_json: '{"regular":"plot"}' };
    const learningCurve: PlotResponse = {
      plotly_json: '{"learning":"curve"}',
    };
    render(
      <PlotSection
        {...defaultProps}
        selectedPlot="learning-curve"
        plotData={plotData}
        learningCurve={learningCurve}
      />,
    );
    const chart = screen.getByTestId("plotly-chart");
    expect(chart).toHaveTextContent('{"learning":"curve"}');
  });

  it("uses height 500 for learning-curve", () => {
    const learningCurve: PlotResponse = { plotly_json: "{}" };
    render(
      <PlotSection
        {...defaultProps}
        selectedPlot="learning-curve"
        learningCurve={learningCurve}
      />,
    );
    const chart = screen.getByTestId("plotly-chart");
    expect(chart).toHaveAttribute("data-height", "500");
  });

  it("uses height 350 for non-learning-curve plots", () => {
    const plotData: PlotResponse = { plotly_json: "{}" };
    render(
      <PlotSection
        {...defaultProps}
        selectedPlot="roc-curve"
        plotData={plotData}
      />,
    );
    const chart = screen.getByTestId("plotly-chart");
    expect(chart).toHaveAttribute("data-height", "350");
  });

  it("calls onSelectPlot when a segment option is clicked", () => {
    const onSelectPlot = vi.fn();
    render(
      <PlotSection
        {...defaultProps}
        onSelectPlot={onSelectPlot}
        selectedPlot="roc-curve"
      />,
    );
    const importanceButton = screen.getByText("Importance");
    fireEvent.click(importanceButton);
    expect(onSelectPlot).toHaveBeenCalledWith("importance");
  });
});
