import { useCallback, useMemo } from "react";
import type { ColumnInfo, UiSchema } from "@/api/types";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  BlockedGroupKFoldEditor,
  type BlockedGroupKFoldState,
  INITIAL_BLOCKED_STATE,
} from "./BlockedGroupKFoldEditor";

export { type BlockedGroupKFoldState, INITIAL_BLOCKED_STATE };

import { CV_STRATEGY_LABELS } from "./constants";
import { NullableNumberField } from "./NullableNumberField";
import { NumberInput } from "./NumberInput";
import { SegmentGroup } from "./SegmentGroup";

// Re-export all public symbols from cv-state for backward compatibility.
// CV_FIELD_DEFAULTS is intentionally NOT re-exported here — it has no
// external consumers; importers use it directly from "./cv-state".
export {
  applyCvDataFields,
  buildSplitConfig,
  type CvState,
  INITIAL_CV_STATE,
  recommendedInnerValid,
  resetCvState,
} from "./cv-state";

import {
  type CvState,
  FALLBACK_CV_STRATEGY_FIELDS,
  resetCvState,
} from "./cv-state";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CvSectionProps {
  cv: CvState;
  onChange: (next: CvState) => void;
  uiSchema?: UiSchema;
  nonExcludedCols: ColumnInfo[];
  blocked?: BlockedGroupKFoldState;
  onBlockedChange?: (next: BlockedGroupKFoldState) => void;
  /**
   * Issue #268: dataset row count threaded down so the Folds NumberInput
   * can clamp to ``min(n_rows, hard_max)``. Optional — when undefined
   * (no data loaded yet) the input falls back to the hard max only.
   */
  nRows?: number;
  /**
   * P-0089 / Issue #279: lock the CV section while a fit/tune job is
   * running. PUT /config returns 409 server-side; disabling the
   * controls here prevents the user from issuing rejected writes and
   * keeps the form value pinned to the config the running job was
   * created with.
   */
  disabled?: boolean;
}

export function CvSection({
  cv,
  onChange,
  uiSchema,
  nonExcludedCols,
  blocked,
  onBlockedChange,
  nRows,
  disabled = false,
}: CvSectionProps) {
  const availableStrategies = useMemo(
    () =>
      uiSchema?.capabilities?.cv_strategies ?? Object.keys(CV_STRATEGY_LABELS),
    [uiSchema],
  );

  const activeFields = useMemo(() => {
    const fromSchema =
      uiSchema?.capabilities?.cv_strategy_fields?.[cv.strategy];
    if (fromSchema !== undefined && fromSchema !== null) {
      return fromSchema;
    }
    return FALLBACK_CV_STRATEGY_FIELDS[cv.strategy] ?? ["n_splits"];
  }, [cv.strategy, uiSchema]);

  const has = useCallback(
    (field: string) => activeFields.includes(field),
    [activeFields],
  );

  const update = useCallback(
    (partial: Partial<CvState>) => onChange({ ...cv, ...partial }),
    [cv, onChange],
  );

  const handleStrategyChange = useCallback(
    (strategy: string) => onChange(resetCvState(strategy)),
    [onChange],
  );

  return (
    <div className="lzs-form space-y-3">
      {/* Strategy segment buttons */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">
          Strategy
        </Label>
        <SegmentGroup
          options={availableStrategies}
          value={cv.strategy}
          onChange={handleStrategyChange}
          labels={CV_STRATEGY_LABELS}
          disabled={disabled}
        />
      </div>

      {/* BlockedGroupKFold: dedicated 2-axis editor */}
      {cv.strategy === "blocked_group_kfold" && blocked && onBlockedChange && (
        <BlockedGroupKFoldEditor
          cv={cv}
          onChange={onChange}
          blocked={blocked}
          onBlockedChange={onBlockedChange}
          nonExcludedCols={nonExcludedCols}
          disabled={disabled}
        />
      )}

      {/* Generic conditional fields (hidden when blocked_group_kfold editor is active) */}
      {cv.strategy !== "blocked_group_kfold" && has("n_splits") && (
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Folds
          </Label>
          <NumberInput
            value={cv.folds}
            onChange={(v) => update({ folds: v ?? 5 })}
            min={2}
            // Issue #268: cap Folds at the dataset row count so the user
            // gets feedback in the input instead of a 5-second silent
            // failure after Fit. Backend validator catches the YAML
            // import / preset path on top of this.
            max={nRows && nRows >= 2 ? nRows : undefined}
            step={1}
            placeholder="5"
            disabled={disabled}
          />
        </div>
      )}

      {cv.strategy !== "blocked_group_kfold" && has("random_state") && (
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Random State
          </Label>
          <NumberInput
            value={cv.randomState}
            onChange={(v) => update({ randomState: v })}
            step={1}
            placeholder="42"
            disabled={disabled}
          />
        </div>
      )}

      {cv.strategy !== "blocked_group_kfold" && has("shuffle") && (
        <div className="flex items-center gap-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Shuffle
          </Label>
          <Switch
            checked={cv.shuffle}
            onCheckedChange={(v) => update({ shuffle: v })}
            disabled={disabled}
          />
        </div>
      )}

      {cv.strategy !== "blocked_group_kfold" && has("group_col") && (
        <div>
          <Label className="text-xs font-medium text-muted-foreground">
            Group column
          </Label>
          <Select
            value={cv.groupCol ?? ""}
            onValueChange={(v) => update({ groupCol: v })}
            disabled={disabled}
          >
            <SelectTrigger aria-label="Group column">
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
      )}

      {cv.strategy !== "blocked_group_kfold" && has("time_col") && (
        <div>
          <Label className="text-xs font-medium text-muted-foreground">
            Time column
          </Label>
          <Select
            value={cv.timeCol ?? ""}
            onValueChange={(v) => update({ timeCol: v })}
            disabled={disabled}
          >
            <SelectTrigger aria-label="Time column">
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
      )}

      {cv.strategy !== "blocked_group_kfold" && has("gap") && (
        <NullableNumberField
          label="Gap"
          value={cv.gap}
          onChange={(v) => update({ gap: v })}
          placeholder="0"
          disabled={disabled}
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("purge_gap") && (
        <NullableNumberField
          label="Purge Gap"
          value={cv.purgeGap}
          onChange={(v) => update({ purgeGap: v })}
          placeholder="0"
          disabled={disabled}
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("embargo") && (
        <NullableNumberField
          label="Embargo"
          value={cv.embargo}
          onChange={(v) => update({ embargo: v })}
          placeholder="0"
          disabled={disabled}
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("train_size_max") && (
        <NullableNumberField
          label="Train Size Max"
          value={cv.trainSizeMax}
          onChange={(v) => update({ trainSizeMax: v })}
          autoHint
          disabled={disabled}
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("test_size_max") && (
        <NullableNumberField
          label="Test Size Max"
          value={cv.testSizeMax}
          onChange={(v) => update({ testSizeMax: v })}
          autoHint
          disabled={disabled}
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("min_train_rows") && (
        <NullableNumberField
          label="Min Train Rows"
          value={cv.minTrainRows}
          onChange={(v) => update({ minTrainRows: v })}
          autoHint
          disabled={disabled}
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("min_valid_rows") && (
        <NullableNumberField
          label="Min Valid Rows"
          value={cv.minValidRows}
          onChange={(v) => update({ minValidRows: v })}
          autoHint
          disabled={disabled}
        />
      )}
    </div>
  );
}
