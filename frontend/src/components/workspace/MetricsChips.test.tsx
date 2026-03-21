import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricsChips } from "./MetricsChips";

describe("MetricsChips", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all available metrics as chips for binary task", () => {
    render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("auc")).toBeInTheDocument();
    expect(screen.getByText("logloss")).toBeInTheDocument();
    expect(screen.getByText("accuracy")).toBeInTheDocument();
    expect(screen.getByText("f1")).toBeInTheDocument();
    expect(screen.getByText("precision")).toBeInTheDocument();
    expect(screen.getByText("recall")).toBeInTheDocument();
  });

  it("renders all available metrics for regression task", () => {
    render(
      <MetricsChips
        task="regression"
        selectedMetrics={["rmse"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("rmse")).toBeInTheDocument();
    expect(screen.getByText("mae")).toBeInTheDocument();
    expect(screen.getByText("r2")).toBeInTheDocument();
    expect(screen.getByText("mse")).toBeInTheDocument();
  });

  it("selected metrics have default variant (dark background via class)", () => {
    render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc"]}
        onChange={vi.fn()}
      />,
    );
    // The selected badge wraps auc — its button should be the parent of the badge
    const aucBadge = screen.getByText("auc").closest("button");
    const loglossButton = screen.getByText("logloss").closest("button");
    // Selected badge has bg-primary class via default variant
    expect(aucBadge?.querySelector(".bg-primary")).not.toBeNull();
    // Non-selected badge does not have bg-primary
    expect(loglossButton?.querySelector(".bg-primary")).toBeNull();
  });

  it("clicking a selected metric deselects it when more than one selected", () => {
    const onChange = vi.fn();
    render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc", "logloss"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("auc").closest("button") as Element);
    expect(onChange).toHaveBeenCalledWith(["logloss"]);
  });

  it("does not deselect when only one metric is selected", () => {
    const onChange = vi.fn();
    render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("auc").closest("button") as Element);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicking an unselected metric adds it to selection", () => {
    const onChange = vi.fn();
    render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("logloss").closest("button") as Element);
    expect(onChange).toHaveBeenCalledWith(["auc", "logloss"]);
  });

  it("resets to defaults when task changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc"]}
        onChange={onChange}
      />,
    );
    rerender(
      <MetricsChips
        task="regression"
        selectedMetrics={["auc"]}
        onChange={onChange}
      />,
    );
    // Should be called with all regression defaults
    expect(onChange).toHaveBeenCalledWith(["rmse", "mae", "r2", "mse"]);
  });

  it("renders nothing when task has no metrics", () => {
    const { container } = render(
      <MetricsChips
        task="unknown_task"
        selectedMetrics={[]}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("uses metricsByTask override when provided", () => {
    const metricsByTask = { custom: ["metric_a", "metric_b"] };
    render(
      <MetricsChips
        task="custom"
        selectedMetrics={["metric_a"]}
        onChange={vi.fn()}
        metricsByTask={metricsByTask}
      />,
    );
    expect(screen.getByText("metric_a")).toBeInTheDocument();
    expect(screen.getByText("metric_b")).toBeInTheDocument();
  });
});
