import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetricEntry } from "@/api/types";
import { MetricsChips } from "./MetricsChips";

const BINARY_METRICS = {
  binary: ["auc", "logloss", "accuracy", "f1", "precision", "recall"],
};
const REGRESSION_METRICS = {
  regression: ["rmse", "mae", "r2", "mse"],
};
const ALL_METRICS = { ...BINARY_METRICS, ...REGRESSION_METRICS };

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
        metricsByTask={BINARY_METRICS}
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
        metricsByTask={REGRESSION_METRICS}
      />,
    );
    expect(screen.getByText("rmse")).toBeInTheDocument();
    expect(screen.getByText("mae")).toBeInTheDocument();
    expect(screen.getByText("r2")).toBeInTheDocument();
    expect(screen.getByText("mse")).toBeInTheDocument();
  });

  it("selected metrics have lzs-chip--active class (chip-style rendering)", () => {
    render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc"]}
        onChange={vi.fn()}
        metricsByTask={BINARY_METRICS}
      />,
    );
    const aucBtn = screen.getByRole("button", { name: "auc" });
    const loglossBtn = screen.getByRole("button", { name: "logloss" });
    // ChipGroup uses lzs-chip--active for selected state
    expect(aucBtn).toHaveClass("lzs-chip--active");
    expect(loglossBtn).not.toHaveClass("lzs-chip--active");
  });

  it("chip buttons expose aria-pressed attribute (chip-style rendering)", () => {
    render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc"]}
        onChange={vi.fn()}
        metricsByTask={BINARY_METRICS}
      />,
    );
    expect(screen.getByRole("button", { name: "auc" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "logloss" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking a selected metric deselects it when more than one selected", () => {
    const onChange = vi.fn();
    render(
      <MetricsChips
        task="binary"
        selectedMetrics={["auc", "logloss"]}
        onChange={onChange}
        metricsByTask={BINARY_METRICS}
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
        metricsByTask={BINARY_METRICS}
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
        metricsByTask={BINARY_METRICS}
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
        metricsByTask={ALL_METRICS}
      />,
    );
    rerender(
      <MetricsChips
        task="regression"
        selectedMetrics={["auc"]}
        onChange={onChange}
        metricsByTask={ALL_METRICS}
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
        metricsByTask={BINARY_METRICS}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when metricsByTask is undefined (uiSchema not yet loaded)", () => {
    const { container } = render(
      <MetricsChips task="binary" selectedMetrics={[]} onChange={vi.fn()} />,
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

  // --- conditional params (precision_at_k) with MetricEntry ---

  it("does not render NumberInput when no conditionalParams provided", () => {
    const metricsByTask = { ranking: ["precision_at_k", "ndcg"] };
    render(
      <MetricsChips
        task="ranking"
        selectedMetrics={[{ precision_at_k: { k: 10 } }]}
        onChange={vi.fn()}
        metricsByTask={metricsByTask}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows labeled NumberInput when precision_at_k is selected and conditionalParams provided", () => {
    const metricsByTask = { ranking: ["precision_at_k", "ndcg"] };
    const conditionalParams = {
      precision_at_k: { label: "k", min: 1, max: 100, default: 10 },
    };
    render(
      <MetricsChips
        task="ranking"
        selectedMetrics={[{ precision_at_k: { k: 10 } }]}
        onChange={vi.fn()}
        metricsByTask={metricsByTask}
        conditionalParams={conditionalParams}
      />,
    );
    expect(screen.getByLabelText("k")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("hides NumberInput when precision_at_k is deselected", () => {
    const metricsByTask = { ranking: ["precision_at_k", "ndcg"] };
    const conditionalParams = {
      precision_at_k: { label: "k", min: 1, max: 100, default: 10 },
    };
    render(
      <MetricsChips
        task="ranking"
        selectedMetrics={["ndcg"]}
        onChange={vi.fn()}
        metricsByTask={metricsByTask}
        conditionalParams={conditionalParams}
      />,
    );
    expect(screen.queryByLabelText("k")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("calls onChange with updated MetricEntry when k value changes", () => {
    const metricsByTask = { ranking: ["precision_at_k", "ndcg"] };
    const conditionalParams = {
      precision_at_k: { label: "k", min: 1, max: 100, default: 10 },
    };
    const onChange = vi.fn();
    render(
      <MetricsChips
        task="ranking"
        selectedMetrics={[{ precision_at_k: { k: 10 } }] as MetricEntry[]}
        onChange={onChange}
        metricsByTask={metricsByTask}
        conditionalParams={conditionalParams}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledWith([{ precision_at_k: { k: 20 } }]);
  });

  it("uses default param value when precision_at_k is a plain string entry", () => {
    const metricsByTask = { ranking: ["precision_at_k", "ndcg"] };
    const conditionalParams = {
      precision_at_k: { label: "k", min: 1, max: 100, default: 10 },
    };
    render(
      <MetricsChips
        task="ranking"
        selectedMetrics={["precision_at_k"]}
        onChange={vi.fn()}
        metricsByTask={metricsByTask}
        conditionalParams={conditionalParams}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("10");
  });

  it("preserves MetricEntry params when toggling other chips", () => {
    const metricsByTask = { ranking: ["precision_at_k", "ndcg", "map"] };
    const conditionalParams = {
      precision_at_k: { label: "k", min: 1, max: 100, default: 10 },
    };
    const onChange = vi.fn();
    render(
      <MetricsChips
        task="ranking"
        selectedMetrics={
          [{ precision_at_k: { k: 20 } }, "ndcg"] as MetricEntry[]
        }
        onChange={onChange}
        metricsByTask={metricsByTask}
        conditionalParams={conditionalParams}
      />,
    );
    // Click "map" to add it
    fireEvent.click(screen.getByText("map").closest("button") as Element);
    expect(onChange).toHaveBeenCalledWith([
      { precision_at_k: { k: 20 } },
      "ndcg",
      "map",
    ]);
  });
});
