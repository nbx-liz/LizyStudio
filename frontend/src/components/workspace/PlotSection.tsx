import { Maximize2 } from "lucide-react";
import { useState } from "react";
import type { ImportanceResponse, PlotResponse } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlotlyChart } from "./PlotlyChart";
import { SegmentGroup } from "./SegmentGroup";

// PR-B4 / R-3.3: PLOT_LABELS must mirror the backend's
// _PLOT_DISPATCH (src/lizystudio/backends/lizyml/evaluation_mixin.py).
// docs/plot-matrix.md tracks the full inventory + symmetry checks;
// any new plot type added on either side must land in both maps in
// the same PR.
//
// Two backend plot IDs are intentionally absent from this map:
//   - tuning       — rendered by TuneTrialsSection, not the tab strip.
//   - shap-summary — Workspace exposes SHAP via `Importance kind=shap`
//                    (Issue #393). Inference renders SHAP via a
//                    dedicated accordion (Issue #373) which does not
//                    use this component.
const PLOT_LABELS: Record<string, string> = {
  "learning-curve": "Learning Curve",
  "oof-distribution": "OOF Dist",
  "roc-curve": "ROC",
  calibration: "Calibration",
  "probability-histogram": "Prob Hist",
  residuals: "Residuals",
  importance: "Importance",
};

const KIND_LABELS: Record<string, string> = {
  split: "Split",
  gain: "Gain",
  shap: "SHAP",
};

// Issue #457 / P-0105: residuals plot kinds. Order is the SegmentGroup
// display order; ``all`` last (the legacy 3-panel default). Mirrors
// lizyml ``plot_residuals._VALID_KINDS`` / backend ``_RESIDUALS_KINDS``.
const RESIDUAL_KINDS: string[] = ["scatter", "histogram", "qq", "all"];
const RESIDUAL_KIND_LABELS: Record<string, string> = {
  scatter: "Scatter",
  histogram: "Histogram",
  qq: "QQ",
  all: "All",
};

interface PlotSectionProps {
  plots: string[];
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
  plotData: PlotResponse | undefined;
  learningCurve: PlotResponse | undefined;
  isLoading?: boolean;
  isError?: boolean;
  /** Selected metric for learning curve filter (null = show all). */
  lcMetric?: string | null;
  onLcMetricChange?: (metric: string | null) => void;
  /** Available model metrics (for the filter selector). */
  availableEvalMetrics?: string[];
  /** Importance kind options (e.g. ["split", "gain", "shap"]). */
  importanceKinds?: string[];
  /** Currently selected importance kind. */
  selectedImportanceKind?: string;
  /** Callback for importance kind change. */
  onImportanceKindChange?: (kind: string) => void;
  /** Importance data for the selected kind (table). */
  importanceData?: ImportanceResponse;
  /** Importance plot data (kind-independent, always default/split). */
  importancePlot?: PlotResponse;
  /** Issue #457 / P-0105: residuals plot data for the selected kind. */
  residualsPlot?: PlotResponse;
  /** Currently selected residuals kind (``"all"`` = legacy 3-panel). */
  selectedResidualsKind?: string;
  /** Callback for residuals kind change. */
  onResidualsKindChange?: (kind: string) => void;
  /**
   * PR-B2 / P-0097: top-N projection for the importance table. `null`
   * means "show all" (no top_n forwarded).
   */
  importanceTopN?: number | null;
  onImportanceTopNChange?: (n: number | null) => void;
}

export function PlotSection({
  plots,
  selectedPlot,
  onSelectPlot,
  plotData,
  learningCurve,
  isLoading = false,
  isError = false,
  lcMetric,
  onLcMetricChange,
  availableEvalMetrics,
  importanceKinds,
  selectedImportanceKind,
  onImportanceKindChange,
  importanceData,
  importancePlot,
  residualsPlot,
  selectedResidualsKind,
  onResidualsKindChange,
  importanceTopN,
  onImportanceTopNChange,
}: PlotSectionProps) {
  // Exclude "tuning" — shown in TuneTrialsSection, not in plot tabs.
  // Exclude "shap-summary" (#393) — SHAP is reachable via the
  // Importance tab's `kind=shap` selector; the standalone tab is
  // redundant in Workspace. Inference renders SHAP via a dedicated
  // accordion (#373) and does not consume this component.
  const availablePlots = plots.filter(
    (p) => p !== "tuning" && p !== "shap-summary",
  );

  // Resolve which data to display
  const isLearningCurve = selectedPlot === "learning-curve";
  const isImportance = selectedPlot === "importance";
  const isResiduals = selectedPlot === "residuals";
  const activePlotData = isLearningCurve
    ? learningCurve
    : isImportance
      ? importancePlot
      : isResiduals
        ? residualsPlot
        : plotData;
  const chartHeight = isLearningCurve ? 500 : 350;

  // Importance: show kind selector when multiple kinds available
  const showImportanceKind =
    isImportance &&
    importanceKinds != null &&
    importanceKinds.length > 1 &&
    onImportanceKindChange != null;

  // Residuals: show the kind selector whenever the residuals tab is
  // active and a change handler is wired (Issue #457).
  const showResidualsKind = isResiduals && onResidualsKindChange != null;
  const residualsKindValue = selectedResidualsKind ?? "all";

  // Show LC filter when: on learning curve tab + more than 1 metric available
  const showLcFilter =
    isLearningCurve &&
    availableEvalMetrics != null &&
    availableEvalMetrics.length > 1 &&
    onLcMetricChange != null;

  const [fullscreen, setFullscreen] = useState(false);

  if (availablePlots.length === 0) return null;

  return (
    <section className="mb-6 min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium">Plots</h4>
        {activePlotData && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => setFullscreen(true)}
            aria-label="Fullscreen plot"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-1 border-b">
        {availablePlots.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onSelectPlot(p)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              p === selectedPlot
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {PLOT_LABELS[p] ?? p}
          </button>
        ))}
      </div>

      {/* Importance kind selector */}
      {showImportanceKind && selectedImportanceKind && (
        <div className="mb-3">
          <SegmentGroup
            options={importanceKinds}
            value={selectedImportanceKind}
            onChange={onImportanceKindChange}
            labels={KIND_LABELS}
          />
        </div>
      )}

      {/* Residuals kind selector (Issue #457) */}
      {showResidualsKind && (
        <div className="mb-3">
          <SegmentGroup
            options={RESIDUAL_KINDS}
            value={residualsKindValue}
            onChange={onResidualsKindChange}
            labels={RESIDUAL_KIND_LABELS}
          />
        </div>
      )}

      {showLcFilter && (
        <div className="mb-3">
          <p className="mb-1 text-xs text-muted-foreground">Filter metrics</p>
          <SegmentGroup
            options={availableEvalMetrics}
            value={
              lcMetric ??
              (availableEvalMetrics.length > 0 ? availableEvalMetrics[0] : "")
            }
            onChange={(v) => onLcMetricChange(v || null)}
          />
        </div>
      )}

      {isLoading && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading plot...
        </p>
      )}
      {isError && !isLoading && (
        <p className="py-8 text-center text-sm text-destructive">
          Failed to load plot. This plot may not be available for this model.
        </p>
      )}
      {!isLoading && !isError && activePlotData && (
        <PlotlyChart
          plotlyJson={activePlotData.plotly_json}
          height={chartHeight}
        />
      )}

      {/* PR-B2 / P-0097: Top-N / Show-all toggle for the importance table. */}
      {isImportance && onImportanceTopNChange && (
        <div
          data-testid="importance-topn-toggle"
          className="mb-2 mt-3 flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span>Show:</span>
          <SegmentGroup
            options={["30", "100", "all"]}
            value={importanceTopN === null ? "all" : String(importanceTopN)}
            onChange={(v) =>
              onImportanceTopNChange(
                v === "all" ? null : Number.parseInt(v, 10),
              )
            }
          />
        </div>
      )}

      {/* Importance table (below plot) */}
      {isImportance &&
        importanceData &&
        Object.keys(importanceData).length > 0 && (
          <div className="mt-3 lzs-scrollable max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead className="text-right">Importance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(importanceData)
                  .sort(([, a], [, b]) => b - a)
                  .map(([name, val]) => (
                    <TableRow
                      key={name}
                      className="hover:bg-muted/50 even:bg-muted/20"
                    >
                      <TableCell className="text-xs">{name}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {val.toFixed(4)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-h-[90vh] max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>
              {isResiduals && residualsKindValue !== "all"
                ? `Residuals — ${RESIDUAL_KIND_LABELS[residualsKindValue] ?? residualsKindValue}`
                : (PLOT_LABELS[selectedPlot] ?? selectedPlot)}
            </DialogTitle>
          </DialogHeader>
          {activePlotData && (
            <PlotlyChart plotlyJson={activePlotData.plotly_json} height={600} />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
