import { Plus, X } from "lucide-react";
import { useId, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FormField } from "./FormField";
import { NumberInput } from "./NumberInput";

interface FeatureWeightsEditorProps {
  weights: Record<string, number> | null; // null = OFF
  columns: string[]; // non-excluded column names to choose from
  onChange: (weights: Record<string, number> | null) => void;
}

/**
 * PR-B2 / P-0097: per-feature weights become unusable in the wide-
 * DataFrame regime — the Add-feature picker would render thousands of
 * SelectItems and the typical "type the column name" interaction does
 * not scale. Lock the toggle above this column count and surface an
 * inline guard message so users learn the limit instead of getting a
 * silently-broken UI.
 */
const FEATURE_WEIGHTS_COLUMN_LIMIT = 1000;

export function FeatureWeightsEditor({
  weights,
  columns,
  onChange,
}: FeatureWeightsEditorProps) {
  const enabled = weights !== null;
  const guardActive = columns.length > FEATURE_WEIGHTS_COLUMN_LIMIT;
  const guardMessageId = useId();
  const entries = useMemo(
    () => (weights ? Object.entries(weights) : []),
    [weights],
  );

  const availableColumns = useMemo(() => {
    const used = new Set(entries.map(([k]) => k));
    return columns.filter((c) => !used.has(c));
  }, [columns, entries]);

  const handleToggle = (checked: boolean) => {
    onChange(checked ? {} : null);
  };

  const handleAdd = (column: string) => {
    onChange({ ...weights, [column]: 1.0 });
  };

  const handleWeightChange = (key: string, value: number | undefined) => {
    if (!weights) return;
    if (value === undefined) {
      const { [key]: _, ...rest } = weights;
      onChange(rest);
    } else {
      onChange({ ...weights, [key]: value });
    }
  };

  const handleRemove = (key: string) => {
    if (!weights) return;
    const { [key]: _, ...rest } = weights;
    onChange(rest);
  };

  return (
    <div>
      <FormField
        label="Feature Weights"
        description="Assign custom weights to features for training"
      >
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          aria-label="Enable feature weights"
          disabled={guardActive}
          aria-describedby={guardActive ? guardMessageId : undefined}
        />
      </FormField>

      {guardActive && (
        <p id={guardMessageId} className="mt-1 text-xs text-muted-foreground">
          Feature Weights is disabled when the workspace has more than{" "}
          {FEATURE_WEIGHTS_COLUMN_LIMIT} columns. Reduce the active column count
          via Column Settings to enable per-feature weighting.
        </p>
      )}

      {enabled && (
        <div className="mt-2 space-y-1.5">
          {entries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs font-mono w-36 truncate text-muted-foreground">
                {key}
              </span>
              <NumberInput
                value={val}
                onChange={(v) => handleWeightChange(key, v)}
                step={0.1}
                min={0.01}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => handleRemove(key)}
                type="button"
                aria-label={`Remove ${key}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {availableColumns.length > 0 && (
            <Select onValueChange={handleAdd}>
              <SelectTrigger
                aria-label="Add feature"
                className="h-7 w-48 text-xs"
              >
                <div className="flex items-center gap-1">
                  <Plus className="h-3 w-3" />
                  <SelectValue placeholder="Add feature..." />
                </div>
              </SelectTrigger>
              <SelectContent>
                {availableColumns.map((col) => (
                  <SelectItem key={col} value={col} className="text-xs">
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
