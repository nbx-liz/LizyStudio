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

  it("calls onSelectPlot when a tab is clicked", () => {
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

  it("uses importancePlot data when selectedPlot is importance", () => {
    const importancePlot: PlotResponse = {
      plotly_json: '{"importance":"plot"}',
    };
    render(
      <PlotSection
        {...defaultProps}
        selectedPlot="importance"
        importancePlot={importancePlot}
      />,
    );
    const chart = screen.getByTestId("plotly-chart");
    expect(chart).toHaveTextContent('{"importance":"plot"}');
  });

  it("renders importance kind selector when multiple kinds available", () => {
    const onKindChange = vi.fn();
    render(
      <PlotSection
        {...defaultProps}
        selectedPlot="importance"
        importanceKinds={["split", "gain", "shap"]}
        selectedImportanceKind="split"
        onImportanceKindChange={onKindChange}
        importancePlot={{ plotly_json: "{}" }}
      />,
    );
    expect(screen.getByRole("radio", { name: "Split" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Gain" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "SHAP" })).toBeInTheDocument();
  });

  it("renders importance table when importanceData is provided", () => {
    render(
      <PlotSection
        {...defaultProps}
        selectedPlot="importance"
        importanceData={{ feature_a: 0.5, feature_b: 0.1, feature_c: 0.3 }}
      />,
    );
    const cells = screen.getAllByRole("cell");
    // Sorted descending: feature_a (0.5), feature_c (0.3), feature_b (0.1)
    expect(cells[0]).toHaveTextContent("feature_a");
    expect(cells[1]).toHaveTextContent("0.5000");
    expect(cells[2]).toHaveTextContent("feature_c");
  });

  it("calls onImportanceKindChange when a different kind is clicked", () => {
    const onKindChange = vi.fn();
    render(
      <PlotSection
        {...defaultProps}
        selectedPlot="importance"
        importanceKinds={["split", "gain"]}
        selectedImportanceKind="split"
        onImportanceKindChange={onKindChange}
        importancePlot={{ plotly_json: "{}" }}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Gain" }));
    expect(onKindChange).toHaveBeenCalledWith("gain");
  });
});
