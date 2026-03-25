import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScoreTable } from "./ScoreTable";

describe("ScoreTable", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleMetrics = {
    inf: { accuracy: 0.91, auc: 0.945 },
    is: { accuracy: 0.95, auc: 0.97 },
    oos: { accuracy: 0.93, auc: 0.96 },
  };

  it("renders IS, OOS, and Inf column headers", () => {
    render(<ScoreTable metrics={sampleMetrics} />);
    expect(screen.getByText("IS")).toBeInTheDocument();
    expect(screen.getByText("OOS")).toBeInTheDocument();
    expect(screen.getByText("Inf")).toBeInTheDocument();
  });

  it("renders metric names as row labels", () => {
    render(<ScoreTable metrics={sampleMetrics} />);
    expect(screen.getByText("accuracy")).toBeInTheDocument();
    expect(screen.getByText("auc")).toBeInTheDocument();
  });

  it("renders formatted metric values with 4 decimal places", () => {
    const metrics = {
      inf: { r2: 0.8 },
      is: { r2: 0.9 },
      oos: { r2: 0.85 },
    };
    render(<ScoreTable metrics={metrics} />);
    expect(screen.getByText("0.8000")).toBeInTheDocument();
    expect(screen.getByText("0.9000")).toBeInTheDocument();
    expect(screen.getByText("0.8500")).toBeInTheDocument();
  });

  it("returns null when metrics have no keys", () => {
    const metrics = {
      inf: {} as Record<string, number>,
      is: {} as Record<string, number>,
      oos: {} as Record<string, number>,
    };
    const { container } = render(<ScoreTable metrics={metrics} />);
    expect(container.innerHTML).toBe("");
  });

  it("highlights degraded score for higher-is-better metrics", () => {
    // inf < oos * 0.9 => degraded
    const metrics = {
      inf: { auc: 0.5 },
      is: { auc: 0.95 },
      oos: { auc: 0.93 },
    };
    render(<ScoreTable metrics={metrics} />);
    // The Inf cell for auc should have orange styling (degraded)
    const infCell = screen.getByText("0.5000");
    expect(infCell.className).toContain("text-orange-600");
  });

  it("does not highlight non-degraded score", () => {
    // inf is close to oos, no degradation
    const metrics = {
      inf: { auc: 0.92 },
      is: { auc: 0.95 },
      oos: { auc: 0.93 },
    };
    render(<ScoreTable metrics={metrics} />);
    const infCell = screen.getByText("0.9200");
    expect(infCell.className).not.toContain("text-orange-600");
  });

  it("highlights degraded score for lower-is-better metrics (mse)", () => {
    // inf > oos * 1.1 => degraded for lower-is-better
    const metrics = {
      inf: { mse: 0.5 },
      is: { mse: 0.1 },
      oos: { mse: 0.15 },
    };
    render(<ScoreTable metrics={metrics} />);
    const infCell = screen.getByText("0.5000");
    expect(infCell.className).toContain("text-orange-600");
  });

  it("does not highlight non-degraded lower-is-better metric", () => {
    const metrics = {
      inf: { rmse: 0.16 },
      is: { rmse: 0.1 },
      oos: { rmse: 0.15 },
    };
    render(<ScoreTable metrics={metrics} />);
    const infCell = screen.getByText("0.1600");
    expect(infCell.className).not.toContain("text-orange-600");
  });

  it("renders multiple metric rows", () => {
    const metrics = {
      inf: { accuracy: 0.9, f1: 0.85, auc: 0.95 },
      is: { accuracy: 0.92, f1: 0.88, auc: 0.97 },
      oos: { accuracy: 0.91, f1: 0.86, auc: 0.96 },
    };
    render(<ScoreTable metrics={metrics} />);
    expect(screen.getByText("accuracy")).toBeInTheDocument();
    expect(screen.getByText("f1")).toBeInTheDocument();
    expect(screen.getByText("auc")).toBeInTheDocument();
  });

  it("shows -- for non-number metric values", () => {
    const metrics = {
      inf: { accuracy: undefined as unknown as number },
      is: { accuracy: 0.95 },
      oos: { accuracy: 0.93 },
    };
    render(<ScoreTable metrics={metrics} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
