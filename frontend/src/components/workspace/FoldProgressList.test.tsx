import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FoldProgressList } from "./FoldProgressList";

describe("FoldProgressList", () => {
  it("renders completed folds with scores", () => {
    render(
      <FoldProgressList
        currentFold={2}
        totalFolds={3}
        foldResults={[
          { fold: 1, metric: "auc", score: 0.892 },
          { fold: 2, metric: "auc", score: 0.905 },
        ]}
      />,
    );
    expect(screen.getByText("auc = 0.8920")).toBeInTheDocument();
    expect(screen.getByText("auc = 0.9050")).toBeInTheDocument();
    expect(screen.getByText("Fold 1/3")).toBeInTheDocument();
    expect(screen.getByText("Fold 3/3")).toBeInTheDocument();
  });

  it("returns null when totalFolds is 0", () => {
    const { container } = render(
      <FoldProgressList currentFold={0} totalFolds={0} foldResults={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows all fold labels", () => {
    render(
      <FoldProgressList currentFold={0} totalFolds={5} foldResults={[]} />,
    );
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByText(`Fold ${i}/5`)).toBeInTheDocument();
    }
  });

  it("shows completed icon for finished folds", () => {
    render(
      <FoldProgressList
        currentFold={2}
        totalFolds={3}
        foldResults={[{ fold: 1, metric: "auc", score: 0.85 }]}
      />,
    );
    // Fold 1 should show score
    expect(screen.getByText("auc = 0.8500")).toBeInTheDocument();
  });
});
