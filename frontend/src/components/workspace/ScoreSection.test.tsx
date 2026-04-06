import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScoreSection } from "./ScoreSection";

describe("ScoreSection", () => {
  afterEach(() => {
    cleanup();
  });

  const singleMetric: Record<string, Record<string, number>> = {
    accuracy: { is: 0.95123, oos: 0.92456 },
  };

  const multipleMetrics: Record<string, Record<string, number>> = {
    accuracy: { is: 0.95123, oos: 0.92456, oos_std: 0.01234 },
    f1: { is: 0.88765, oos: 0.85432, oos_std: 0.0235 },
    auc: { is: 0.97654, oos: 0.94321, oos_std: 0.00567 },
  };

  const identity = (name: string) => name;

  it("renders Score heading", () => {
    render(
      <ScoreSection
        metrics={singleMetric}
        hasFolds={false}
        annotateMetric={identity}
      />,
    );
    expect(screen.getByText("Score")).toBeInTheDocument();
  });

  it("renders IS and OOS column headers", () => {
    render(
      <ScoreSection
        metrics={singleMetric}
        hasFolds={false}
        annotateMetric={identity}
      />,
    );
    expect(screen.getByText("IS")).toBeInTheDocument();
    expect(screen.getByText("OOS")).toBeInTheDocument();
  });

  it("renders OOS Std column when hasFolds is true", () => {
    render(
      <ScoreSection
        metrics={multipleMetrics}
        hasFolds={true}
        annotateMetric={identity}
      />,
    );
    expect(screen.getByText("OOS Std")).toBeInTheDocument();
  });

  it("does not render OOS Std column when hasFolds is false", () => {
    render(
      <ScoreSection
        metrics={singleMetric}
        hasFolds={false}
        annotateMetric={identity}
      />,
    );
    expect(screen.queryByText("OOS Std")).toBeNull();
  });

  it("renders metric rows with annotateMetric applied to name", () => {
    const annotate = vi.fn((name: string) => `[${name}]`);
    render(
      <ScoreSection
        metrics={singleMetric}
        hasFolds={false}
        annotateMetric={annotate}
      />,
    );
    expect(annotate).toHaveBeenCalledWith("accuracy");
    expect(screen.getByText("[accuracy]")).toBeInTheDocument();
  });

  describe("formatNum", () => {
    it("shows 4 decimal places for numbers", () => {
      const metrics = { m: { is: 0.95123, oos: 0.1 } };
      render(
        <ScoreSection
          metrics={metrics}
          hasFolds={false}
          annotateMetric={identity}
        />,
      );
      expect(screen.getByText("0.9512")).toBeInTheDocument();
      expect(screen.getByText("0.1000")).toBeInTheDocument();
    });

    it('shows "—" for NaN values', () => {
      const metrics = { m: { is: Number.NaN, oos: 0.5 } };
      render(
        <ScoreSection
          metrics={metrics}
          hasFolds={false}
          annotateMetric={identity}
        />,
      );
      expect(screen.getByText("—")).toBeInTheDocument();
      expect(screen.getByText("0.5000")).toBeInTheDocument();
    });

    it('shows "—" for non-number values', () => {
      // Force a non-number value through the type system
      const metrics = { m: { is: "hello" as unknown as number, oos: 0.5 } };
      render(
        <ScoreSection
          metrics={metrics}
          hasFolds={false}
          annotateMetric={identity}
        />,
      );
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  it("renders multiple metrics correctly", () => {
    render(
      <ScoreSection
        metrics={multipleMetrics}
        hasFolds={true}
        annotateMetric={identity}
      />,
    );
    expect(screen.getByText("accuracy")).toBeInTheDocument();
    expect(screen.getByText("f1")).toBeInTheDocument();
    expect(screen.getByText("auc")).toBeInTheDocument();
    // Verify values are formatted
    expect(screen.getByText("0.9512")).toBeInTheDocument();
    expect(screen.getByText("0.8877")).toBeInTheDocument();
    expect(screen.getByText("0.9765")).toBeInTheDocument();
    // Verify OOS Std values
    expect(screen.getByText("0.0123")).toBeInTheDocument();
    expect(screen.getByText("0.0235")).toBeInTheDocument();
    expect(screen.getByText("0.0057")).toBeInTheDocument();
  });
});
