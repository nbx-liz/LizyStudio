import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "@/api/errors";
import type { ColumnInfo, ColumnStatsResponse, ValueCount } from "@/api/types";
import { fetchColumnStats } from "@/api/workspace";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CvState } from "./CvSection";
import { DistributionBar } from "./DistributionBar";
import { NumberInput } from "./NumberInput";
import { SegmentGroup } from "./SegmentGroup";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended state for blocked_group_kfold strategy. */
export interface BlockedGroupKFoldState {
  /** Cutoff values that define block boundaries (toggled ON). */
  cutoffs: string[];
  /** CV expansion mode: expanding keeps all earlier blocks, sliding uses a window. */
  blockMode: "expanding" | "sliding";
  /** Number of training periods for sliding mode. */
  trainWindow: number;
  /** Group-level stratification: auto, on, off. */
  stratify: "auto" | "on" | "off";
}

export const INITIAL_BLOCKED_STATE: BlockedGroupKFoldState = {
  cutoffs: [],
  blockMode: "expanding",
  trainWindow: 1,
  stratify: "auto",
};

/** Period derived from cutoff selections. */
interface Period {
  label: string;
  values: string[];
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BlockedGroupKFoldEditorProps {
  cv: CvState;
  onChange: (next: CvState) => void;
  blocked: BlockedGroupKFoldState;
  onBlockedChange: (next: BlockedGroupKFoldState) => void;
  nonExcludedCols: ColumnInfo[];
  /**
   * P-0089 / Issue #279: lock the editor while a fit/tune job is
   * running. The wrapping ``<fieldset disabled>`` natively prevents
   * pointer / keyboard input from reaching the nested controls; the
   * inner Radix triggers honor it because they render as ``<button>``
   * elements and inherit the fieldset disabled attribute.
   */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockedGroupKFoldEditor({
  cv,
  onChange,
  blocked,
  onBlockedChange,
  nonExcludedCols,
  disabled = false,
}: BlockedGroupKFoldEditorProps) {
  const [blockStats, setBlockStats] = useState<ColumnStatsResponse | null>(
    null,
  );
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const updateCv = useCallback(
    (partial: Partial<CvState>) => onChange({ ...cv, ...partial }),
    [cv, onChange],
  );

  const updateBlocked = useCallback(
    (partial: Partial<BlockedGroupKFoldState>) =>
      onBlockedChange({ ...blocked, ...partial }),
    [blocked, onBlockedChange],
  );

  // Stable ref for onBlockedChange to avoid re-triggering the effect
  const onBlockedChangeRef = useRef(onBlockedChange);
  onBlockedChangeRef.current = onBlockedChange;

  // Fetch column stats when block column changes
  useEffect(() => {
    if (!cv.timeCol) {
      setBlockStats(null);
      return;
    }

    let cancelled = false;
    setStatsLoading(true);
    setStatsError(null);

    fetchColumnStats(cv.timeCol, 100)
      .then((data) => {
        if (!cancelled) {
          setBlockStats(data);
          // Auto-select last value as cutoff (always required)
          if (data.value_counts.length > 0) {
            const lastVal =
              data.value_counts[data.value_counts.length - 1].value;
            onBlockedChangeRef.current({
              ...INITIAL_BLOCKED_STATE,
              cutoffs: [lastVal],
            });
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStatsError(getErrorMessage(err));
          setBlockStats(null);
        }
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cv.timeCol]);

  // Unique values from block column stats
  const blockValues = useMemo(
    () =>
      blockStats?.value_counts.filter((vc) => vc.value !== "__other__") ?? [],
    [blockStats],
  );

  const lastValue = useMemo(
    () => (blockValues.length > 0 ? blockValues[blockValues.length - 1] : null),
    [blockValues],
  );

  // Derive periods from cutoffs
  const periods = useMemo(
    () => derivePeriods(blockValues, blocked.cutoffs),
    [blockValues, blocked.cutoffs],
  );

  // Columns available for groups (exclude block column)
  const groupCols = useMemo(
    () => nonExcludedCols.filter((c) => c.name !== cv.timeCol),
    [nonExcludedCols, cv.timeCol],
  );

  const handleCutoffToggle = useCallback(
    (val: string) => {
      // Last value is always a cutoff and cannot be toggled off
      if (lastValue && val === lastValue.value) return;

      const isSelected = blocked.cutoffs.includes(val);
      const next = isSelected
        ? blocked.cutoffs.filter((c) => c !== val)
        : [...blocked.cutoffs, val];
      updateBlocked({ cutoffs: next });
    },
    [blocked.cutoffs, lastValue, updateBlocked],
  );

  return (
    <fieldset
      className="space-y-4 disabled:opacity-60"
      disabled={disabled}
      data-testid="blocked-group-kfold-editor"
    >
      {/* ===== Blocks Section ===== */}
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-xs font-semibold text-muted-foreground">
          Blocks (Time Axis)
        </legend>

        {/* Block column selection */}
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Block Column
          </Label>
          <Select
            value={cv.timeCol ?? ""}
            onValueChange={(v) => updateCv({ timeCol: v })}
          >
            <SelectTrigger
              aria-label="Block column"
              data-testid="block-col-select"
            >
              <SelectValue placeholder="Select column" />
            </SelectTrigger>
            <SelectContent>
              {nonExcludedCols.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Distribution bar */}
        {statsLoading && (
          <p
            className="text-xs text-muted-foreground animate-pulse"
            data-testid="block-stats-loading"
          >
            Loading column stats...
          </p>
        )}
        {statsError && (
          <p
            className="text-xs text-destructive"
            data-testid="block-stats-error"
          >
            {statsError}
          </p>
        )}
        {blockStats && !statsLoading && (
          <DistributionBar
            valueCounts={blockStats.value_counts}
            totalCount={blockStats.total_count}
          />
        )}

        {/* Cutoff chips */}
        {blockValues.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">
              Cutoff Points
            </Label>
            <fieldset
              className="flex flex-wrap gap-1 border-0 p-0 m-0"
              aria-label="Cutoff selection"
              data-testid="cutoff-chips"
            >
              {blockValues.map((vc) => {
                const isLast = lastValue?.value === vc.value;
                const isActive = blocked.cutoffs.includes(vc.value);
                return (
                  <button
                    key={vc.value}
                    type="button"
                    className={`lzs-chip${isActive ? " lzs-chip--active" : ""}${isLast ? " cursor-not-allowed opacity-70" : ""}`}
                    aria-pressed={isActive}
                    disabled={isLast}
                    onClick={() => handleCutoffToggle(vc.value)}
                    title={
                      isLast
                        ? "Last value is always required as a cutoff"
                        : undefined
                    }
                    data-testid={`cutoff-${vc.value}`}
                  >
                    {vc.value}
                    {isLast && (
                      <span className="ml-0.5 text-[10px] opacity-60">
                        (fixed)
                      </span>
                    )}
                  </button>
                );
              })}
            </fieldset>
          </div>
        )}

        {/* Period preview */}
        {periods.length > 0 && (
          <div className="space-y-1" data-testid="period-preview">
            <Label className="text-xs font-medium text-muted-foreground">
              Periods
            </Label>
            <div className="text-xs space-y-0.5">
              {periods.map((p) => (
                <div
                  key={p.label}
                  className="flex justify-between text-muted-foreground"
                >
                  <span>{p.label}</span>
                  <span>{p.rowCount.toLocaleString()} rows</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mode: Expanding / Sliding */}
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Mode
          </Label>
          <SegmentGroup
            options={["expanding", "sliding"]}
            value={blocked.blockMode}
            onChange={(v) =>
              updateBlocked({ blockMode: v as "expanding" | "sliding" })
            }
            labels={{ expanding: "Expanding", sliding: "Sliding" }}
          />
        </div>

        {/* Train Window (Sliding mode only) */}
        {blocked.blockMode === "sliding" && (
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">
              Train Window
            </Label>
            <NumberInput
              value={blocked.trainWindow}
              onChange={(v) => updateBlocked({ trainWindow: v ?? 1 })}
              min={1}
              step={1}
              placeholder="1"
            />
          </div>
        )}
      </fieldset>

      {/* ===== Groups Section ===== */}
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-xs font-semibold text-muted-foreground">
          Groups (Entity Axis)
        </legend>

        {/* Group column selection */}
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Group Column
          </Label>
          <Select
            value={cv.groupCol ?? ""}
            onValueChange={(v) => updateCv({ groupCol: v })}
          >
            <SelectTrigger
              aria-label="Group column"
              data-testid="group-col-select"
            >
              <SelectValue placeholder="Select column" />
            </SelectTrigger>
            <SelectContent>
              {groupCols.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* n_splits */}
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Splits
          </Label>
          <NumberInput
            value={cv.folds}
            onChange={(v) => updateCv({ folds: v ?? 2 })}
            min={2}
            max={10}
            step={1}
            placeholder="5"
          />
        </div>

        {/* Stratify */}
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Stratify
          </Label>
          <SegmentGroup
            options={["auto", "on", "off"]}
            value={blocked.stratify}
            onChange={(v) =>
              updateBlocked({ stratify: v as "auto" | "on" | "off" })
            }
            labels={{ auto: "Auto", on: "On", off: "Off" }}
          />
        </div>

        {/* Shuffle */}
        <div className="flex items-center gap-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Shuffle
          </Label>
          <Switch
            checked={cv.shuffle}
            onCheckedChange={(v) => updateCv({ shuffle: v })}
          />
        </div>
      </fieldset>

      {/* ===== Min Rows Section ===== */}
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-xs font-semibold text-muted-foreground">
          Min Rows
        </legend>

        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Min Train Rows
            <span className="text-muted-foreground text-[10px] ml-1">
              (empty = auto)
            </span>
          </Label>
          <NumberInput
            value={cv.minTrainRows}
            onChange={(v) => updateCv({ minTrainRows: v })}
            min={1}
            step={1}
            placeholder="Auto"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Min Valid Rows
            <span className="text-muted-foreground text-[10px] ml-1">
              (empty = auto)
            </span>
          </Label>
          <NumberInput
            value={cv.minValidRows}
            onChange={(v) => updateCv({ minValidRows: v })}
            min={1}
            step={1}
            placeholder="Auto"
          />
        </div>
      </fieldset>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Pure helper: derive periods from value counts and cutoff selections
// ---------------------------------------------------------------------------

/**
 * Given an ordered list of unique values and selected cutoff points,
 * partition the values into periods (P0, P1, ...).
 * Each cutoff marks the end of a period.
 */
export function derivePeriods(
  values: ValueCount[],
  cutoffs: string[],
): Period[] {
  if (values.length === 0 || cutoffs.length === 0) return [];

  // Sort cutoffs by their index in the values array
  const cutoffSet = new Set(cutoffs);
  const sortedCutoffIndices = values
    .map((vc, idx) => ({ value: vc.value, idx }))
    .filter((item) => cutoffSet.has(item.value))
    .sort((a, b) => a.idx - b.idx);

  if (sortedCutoffIndices.length === 0) return [];

  const periods: Period[] = [];
  let periodStart = 0;

  for (let i = 0; i < sortedCutoffIndices.length; i++) {
    const cutoffIdx = sortedCutoffIndices[i].idx;
    const periodValues = values.slice(periodStart, cutoffIdx + 1);
    const rowCount = periodValues.reduce((sum, vc) => sum + vc.count, 0);

    periods.push({
      label: `P${i}`,
      values: periodValues.map((vc) => vc.value),
      rowCount,
    });

    periodStart = cutoffIdx + 1;
  }

  return periods;
}
