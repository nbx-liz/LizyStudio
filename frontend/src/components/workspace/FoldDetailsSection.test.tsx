import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FitResult, SplitSummaryRow } from "@/api/types";
import { Accordion } from "@/components/ui/accordion";
import { FoldDetailsSection } from "./FoldDetailsSection";

interface FoldDetailsSectionProps {
  fitResult: FitResult;
  hasFolds: boolean;
  splitSummary: SplitSummaryRow[] | undefined;
}

function renderSection(props: FoldDetailsSectionProps) {
  return render(
    <Accordion type="multiple" defaultValue={["folds", "params"]}>
      <FoldDetailsSection {...props} />
    </Accordion>,
  );
}

const baseFitResult: FitResult = {
  metrics: { accuracy: 0.95 },
  fold_count: 5,
  params: [],
};

describe("FoldDetailsSection", () => {
  afterEach(() => {
    cleanup();
  });

  describe("Fold Details", () => {
    it("does not render when hasFolds is false", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: [{ fold: 0, accuracy: 0.9 }],
      });
      expect(screen.queryByText("Fold Details")).not.toBeInTheDocument();
    });

    it("does not render when splitSummary is undefined", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: true,
        splitSummary: undefined,
      });
      expect(screen.queryByText("Fold Details")).not.toBeInTheDocument();
    });

    it("does not render when splitSummary is empty", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: true,
        splitSummary: [],
      });
      expect(screen.queryByText("Fold Details")).not.toBeInTheDocument();
    });

    it("renders table when hasFolds is true and splitSummary has rows", () => {
      const splitSummary: SplitSummaryRow[] = [
        { fold: 0, accuracy: 0.9 },
        { fold: 1, accuracy: 0.95 },
      ];
      renderSection({
        fitResult: baseFitResult,
        hasFolds: true,
        splitSummary,
      });
      expect(screen.getByText("Fold Details")).toBeInTheDocument();
      expect(screen.getByText("fold")).toBeInTheDocument();
      expect(screen.getByText("accuracy")).toBeInTheDocument();
      expect(screen.getByText("0.9000")).toBeInTheDocument();
      expect(screen.getByText("0.9500")).toBeInTheDocument();
    });
  });

  describe("Parameters", () => {
    it("renders section when fitResult.params has entries", () => {
      const fitResult: FitResult = {
        metrics: {},
        fold_count: 1,
        params: [
          { parameter: "learning_rate", value: 0.01 },
          { parameter: "max_depth", value: 6 },
        ],
      };
      renderSection({
        fitResult,
        hasFolds: false,
        splitSummary: undefined,
      });
      expect(screen.getByText("Parameters")).toBeInTheDocument();
      expect(screen.getByText("learning_rate")).toBeInTheDocument();
      expect(screen.getByText("0.0100")).toBeInTheDocument();
      expect(screen.getByText("max_depth")).toBeInTheDocument();
      expect(screen.getByText("6.0000")).toBeInTheDocument();
    });

    it("does not render when fitResult.params is empty", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: undefined,
      });
      expect(screen.queryByText("Parameters")).not.toBeInTheDocument();
    });
  });
});
