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

import { CV_STRATEGY_FIELDS, CV_STRATEGY_LABELS } from "./constants";
import { NullableNumberField } from "./NullableNumberField";
import { NumberInput } from "./NumberInput";
import { SegmentGroup } from "./SegmentGroup";

// Re-export all public symbols from cv-state for backward compatibility
export {
  applyCvDataFields,
  buildSplitConfig,
  CV_FIELD_DEFAULTS,
  type CvState,
  INITIAL_CV_STATE,
  recommendedInnerValid,
  resetCvState,
} from "./cv-state";

import { type CvState, resetCvState } from "./cv-state";

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
}

export function CvSection({
  cv,
  onChange,
  uiSchema,
  nonExcludedCols,
  blocked,
  onBlockedChange,
}: CvSectionProps) {
  const availableStrategies = useMemo(
    () =>
      uiSchema?.capabilities?.cv_strategies ?? Object.keys(CV_STRATEGY_LABELS),
    [uiSchema],
  );

  const activeFields = useMemo(
    () => CV_STRATEGY_FIELDS[cv.strategy] ?? ["folds"],
    [cv.strategy],
  );

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
        />
      )}

      {/* Generic conditional fields (hidden when blocked_group_kfold editor is active) */}
      {cv.strategy !== "blocked_group_kfold" && has("folds") && (
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Folds
          </Label>
          <NumberInput
            value={cv.folds}
            onChange={(v) => update({ folds: v ?? 5 })}
            min={2}
            step={1}
            placeholder="5"
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
          >
            <SelectTrigger>
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
          >
            <SelectTrigger>
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
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("purge_gap") && (
        <NullableNumberField
          label="Purge Gap"
          value={cv.purgeGap}
          onChange={(v) => update({ purgeGap: v })}
          placeholder="0"
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("embargo") && (
        <NullableNumberField
          label="Embargo"
          value={cv.embargo}
          onChange={(v) => update({ embargo: v })}
          placeholder="0"
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("train_size_max") && (
        <NullableNumberField
          label="Train Size Max"
          value={cv.trainSizeMax}
          onChange={(v) => update({ trainSizeMax: v })}
          autoHint
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("test_size_max") && (
        <NullableNumberField
          label="Test Size Max"
          value={cv.testSizeMax}
          onChange={(v) => update({ testSizeMax: v })}
          autoHint
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("min_train_rows") && (
        <NullableNumberField
          label="Min Train Rows"
          value={cv.minTrainRows}
          onChange={(v) => update({ minTrainRows: v })}
          autoHint
        />
      )}

      {cv.strategy !== "blocked_group_kfold" && has("min_valid_rows") && (
        <NullableNumberField
          label="Min Valid Rows"
          value={cv.minValidRows}
          onChange={(v) => update({ minValidRows: v })}
          autoHint
        />
      )}
    </div>
  );
}
