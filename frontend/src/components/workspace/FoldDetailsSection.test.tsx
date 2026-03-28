import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FitResult,
  ImportanceResponse,
  PlotResponse,
  SplitSummaryRow,
} from "@/api/types";
import { Accordion } from "@/components/ui/accordion";
import { FoldDetailsSection } from "./FoldDetailsSection";

vi.mock("./PlotlyChart", () => ({
  PlotlyChart: ({ plotlyJson }: { plotlyJson: string }) => (
    <div data-testid="plotly-chart">{plotlyJson}</div>
  ),
}));

interface FoldDetailsSectionProps {
  fitResult: FitResult;
  hasFolds: boolean;
  splitSummary: SplitSummaryRow[] | undefined;
  importance: ImportanceResponse | undefined;
  importancePlot: PlotResponse | undefined;
  importanceKinds?: string[];
  selectedKind?: string;
  onKindChange?: (kind: string) => void;
}

function renderSection(props: FoldDetailsSectionProps) {
  return render(
    <Accordion type="multiple" defaultValue={["importance", "folds", "params"]}>
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

  describe("Feature Importance", () => {
    it("does not render when importancePlot and importance are both undefined", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: undefined,
        importance: undefined,
        importancePlot: undefined,
      });
      expect(screen.queryByText("Feature Importance")).not.toBeInTheDocument();
    });

    it("renders heading when importancePlot is provided", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: undefined,
        importance: undefined,
        importancePlot: { plotly_json: '{"data":[],"layout":{}}' },
      });
      expect(screen.getByText("Feature Importance")).toBeInTheDocument();
      expect(screen.getByTestId("plotly-chart")).toBeInTheDocument();
    });

    it("renders importance table sorted by value descending", () => {
      const importance: ImportanceResponse = {
        feature_a: 0.1,
        feature_b: 0.5,
        feature_c: 0.3,
      };
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: undefined,
        importance,
        importancePlot: undefined,
      });
      expect(screen.getByText("Feature Importance")).toBeInTheDocument();
      const cells = screen.getAllByRole("cell");
      // Sorted: feature_b (0.5), feature_c (0.3), feature_a (0.1)
      expect(cells[0]).toHaveTextContent("feature_b");
      expect(cells[1]).toHaveTextContent("0.5000");
      expect(cells[2]).toHaveTextContent("feature_c");
      expect(cells[3]).toHaveTextContent("0.3000");
      expect(cells[4]).toHaveTextContent("feature_a");
      expect(cells[5]).toHaveTextContent("0.1000");
    });

    it("renders kind selector when importanceKinds has multiple options", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: undefined,
        importance: { feature_a: 0.5 },
        importancePlot: undefined,
        importanceKinds: ["split", "gain", "shap"],
        selectedKind: "split",
        onKindChange: vi.fn(),
      });
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Split" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Gain" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "SHAP" })).toBeInTheDocument();
    });

    it("calls onKindChange when a different kind is selected", async () => {
      const onKindChange = vi.fn();
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: undefined,
        importance: { feature_a: 0.5 },
        importancePlot: undefined,
        importanceKinds: ["split", "gain", "shap"],
        selectedKind: "split",
        onKindChange,
      });
      await userEvent.click(screen.getByRole("radio", { name: "Gain" }));
      expect(onKindChange).toHaveBeenCalledWith("gain");
    });

    it("does not render kind selector when importanceKinds is undefined", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: undefined,
        importance: { feature_a: 0.5 },
        importancePlot: undefined,
      });
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    });
  });

  describe("Fold Details", () => {
    it("does not render when hasFolds is false", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: [{ fold: 0, accuracy: 0.9 }],
        importance: undefined,
        importancePlot: undefined,
      });
      expect(screen.queryByText("Fold Details")).not.toBeInTheDocument();
    });

    it("does not render when splitSummary is undefined", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: true,
        splitSummary: undefined,
        importance: undefined,
        importancePlot: undefined,
      });
      expect(screen.queryByText("Fold Details")).not.toBeInTheDocument();
    });

    it("does not render when splitSummary is empty", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: true,
        splitSummary: [],
        importance: undefined,
        importancePlot: undefined,
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
        importance: undefined,
        importancePlot: undefined,
      });
      expect(screen.getByText("Fold Details")).toBeInTheDocument();
      // Column headers from keys
      expect(screen.getByText("fold")).toBeInTheDocument();
      expect(screen.getByText("accuracy")).toBeInTheDocument();
      // Row values
      expect(screen.getByText("0.9000")).toBeInTheDocument();
      expect(screen.getByText("0.9500")).toBeInTheDocument();
    });
  });

  describe("Parameters", () => {
    it("renders section when fitResult.params has entries", () => {
      const fitResult: FitResult = {
        metrics: {},
        fold_count: 1,
        params: [{ learning_rate: 0.01, max_depth: 6 }],
      };
      renderSection({
        fitResult,
        hasFolds: false,
        splitSummary: undefined,
        importance: undefined,
        importancePlot: undefined,
      });
      expect(screen.getByText("Parameters")).toBeInTheDocument();
      expect(screen.getByText("learning_rate")).toBeInTheDocument();
      expect(screen.getByText("0.01")).toBeInTheDocument();
      expect(screen.getByText("max_depth")).toBeInTheDocument();
      expect(screen.getByText("6")).toBeInTheDocument();
    });

    it("does not render when fitResult.params is empty", () => {
      renderSection({
        fitResult: baseFitResult,
        hasFolds: false,
        splitSummary: undefined,
        importance: undefined,
        importancePlot: undefined,
      });
      expect(screen.queryByText("Parameters")).not.toBeInTheDocument();
    });
  });
});
