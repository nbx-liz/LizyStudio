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
import { CV_STRATEGY_FIELDS, CV_STRATEGY_LABELS } from "./constants";
import { NumberInput } from "./NumberInput";
import { SegmentGroup } from "./SegmentGroup";

/** Default values for CV fields, reset when strategy changes. */
const CV_FIELD_DEFAULTS = {
  folds: 5,
  random_state: 42,
  shuffle: true,
  gap: 0,
  purge_gap: 0,
  embargo: 0,
} as const;

export interface CvState {
  strategy: string;
  folds: number;
  randomState: number | undefined;
  shuffle: boolean;
  groupCol: string | null;
  timeCol: string | null;
  gap: number | undefined;
  purgeGap: number | undefined;
  embargo: number | undefined;
  trainSizeMax: number | undefined;
  testSizeMax: number | undefined;
  minTrainRows: number | undefined;
  minValidRows: number | undefined;
}

export const INITIAL_CV_STATE: CvState = {
  strategy: "stratified_kfold",
  folds: CV_FIELD_DEFAULTS.folds,
  randomState: CV_FIELD_DEFAULTS.random_state,
  shuffle: CV_FIELD_DEFAULTS.shuffle,
  groupCol: null,
  timeCol: null,
  gap: CV_FIELD_DEFAULTS.gap,
  purgeGap: CV_FIELD_DEFAULTS.purge_gap,
  embargo: CV_FIELD_DEFAULTS.embargo,
  trainSizeMax: undefined,
  testSizeMax: undefined,
  minTrainRows: undefined,
  minValidRows: undefined,
};

/** Reset all conditional CV fields to defaults (called on strategy change). */
export function resetCvState(strategy: string): CvState {
  return { ...INITIAL_CV_STATE, strategy };
}

/** Build a split config object containing only strategy-relevant fields. */
export function buildSplitConfig(cv: CvState): Record<string, unknown> {
  const fields = CV_STRATEGY_FIELDS[cv.strategy] ?? ["folds"];
  const split: Record<string, unknown> = {
    method: cv.strategy,
    n_splits: cv.folds,
  };
  if (fields.includes("random_state") && cv.randomState !== undefined) {
    split.random_state = cv.randomState;
  }
  if (fields.includes("shuffle")) {
    split.shuffle = cv.shuffle;
  }
  if (fields.includes("gap") && cv.gap !== undefined) {
    split.gap = cv.gap;
  }
  if (fields.includes("purge_gap") && cv.purgeGap !== undefined) {
    split.purge_gap = cv.purgeGap;
  }
  if (fields.includes("embargo") && cv.embargo !== undefined) {
    split.embargo = cv.embargo;
  }
  if (fields.includes("train_size_max") && cv.trainSizeMax !== undefined) {
    split.train_size_max = cv.trainSizeMax;
  }
  if (fields.includes("test_size_max") && cv.testSizeMax !== undefined) {
    split.test_size_max = cv.testSizeMax;
  }
  if (fields.includes("min_train_rows") && cv.minTrainRows !== undefined) {
    split.min_train_rows = cv.minTrainRows;
  }
  if (fields.includes("min_valid_rows") && cv.minValidRows !== undefined) {
    split.min_valid_rows = cv.minValidRows;
  }
  return split;
}

/** Extract group_col / time_col into data config when strategy requires them. */
export function applyCvDataFields(
  data: Record<string, unknown>,
  cv: CvState,
): Record<string, unknown> {
  const fields = CV_STRATEGY_FIELDS[cv.strategy] ?? [];
  const result = { ...data };
  if (fields.includes("group_col") && cv.groupCol) {
    result.group_col = cv.groupCol;
  }
  if (fields.includes("time_col") && cv.timeCol) {
    result.time_col = cv.timeCol;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CvSectionProps {
  cv: CvState;
  onChange: (next: CvState) => void;
  uiSchema?: UiSchema;
  nonExcludedCols: ColumnInfo[];
}

export function CvSection({
  cv,
  onChange,
  uiSchema,
  nonExcludedCols,
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
    <div className="lzs-form space-y-1.5">
      {/* Strategy segment buttons */}
      <div className="space-y-2">
        <Label>Strategy</Label>
        <SegmentGroup
          options={availableStrategies}
          value={cv.strategy}
          onChange={handleStrategyChange}
          labels={CV_STRATEGY_LABELS}
        />
      </div>

      {/* Conditional fields */}
      {has("folds") && (
        <div className="space-y-1">
          <Label>Folds</Label>
          <NumberInput
            value={cv.folds}
            onChange={(v) => update({ folds: v ?? 5 })}
            min={2}
            step={1}
            placeholder="5"
          />
        </div>
      )}

      {has("random_state") && (
        <div className="space-y-1">
          <Label>Random State</Label>
          <NumberInput
            value={cv.randomState}
            onChange={(v) => update({ randomState: v })}
            step={1}
            placeholder="42"
          />
        </div>
      )}

      {has("shuffle") && (
        <div className="flex items-center gap-2">
          <Label>Shuffle</Label>
          <Switch
            checked={cv.shuffle}
            onCheckedChange={(v) => update({ shuffle: v })}
          />
        </div>
      )}

      {has("group_col") && (
        <div>
          <Label>Group column</Label>
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

      {has("time_col") && (
        <div>
          <Label>Time column</Label>
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

      {has("gap") && (
        <NullableNumberField
          label="Gap"
          value={cv.gap}
          onChange={(v) => update({ gap: v })}
          placeholder="0"
        />
      )}

      {has("purge_gap") && (
        <NullableNumberField
          label="Purge Gap"
          value={cv.purgeGap}
          onChange={(v) => update({ purgeGap: v })}
          placeholder="0"
        />
      )}

      {has("embargo") && (
        <NullableNumberField
          label="Embargo"
          value={cv.embargo}
          onChange={(v) => update({ embargo: v })}
          placeholder="0"
        />
      )}

      {has("train_size_max") && (
        <NullableNumberField
          label="Train Size Max"
          value={cv.trainSizeMax}
          onChange={(v) => update({ trainSizeMax: v })}
          autoHint
        />
      )}

      {has("test_size_max") && (
        <NullableNumberField
          label="Test Size Max"
          value={cv.testSizeMax}
          onChange={(v) => update({ testSizeMax: v })}
          autoHint
        />
      )}

      {has("min_train_rows") && (
        <NullableNumberField
          label="Min Train Rows"
          value={cv.minTrainRows}
          onChange={(v) => update({ minTrainRows: v })}
          autoHint
        />
      )}

      {has("min_valid_rows") && (
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

// ---------------------------------------------------------------------------
// Small helper for nullable integer fields
// ---------------------------------------------------------------------------

function NullableNumberField({
  label,
  value,
  onChange,
  placeholder,
  autoHint,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  autoHint?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {autoHint && (
          <span className="text-muted-foreground text-[10px] ml-1">
            (empty = auto)
          </span>
        )}
      </Label>
      <NumberInput
        value={value}
        onChange={onChange}
        min={autoHint ? 1 : 0}
        step={1}
        placeholder={placeholder ?? "Auto"}
      />
    </div>
  );
}
