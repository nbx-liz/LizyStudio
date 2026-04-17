import { Plus, X } from "lucide-react";
import { useMemo } from "react";
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

export function FeatureWeightsEditor({
  weights,
  columns,
  onChange,
}: FeatureWeightsEditorProps) {
  const enabled = weights !== null;
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
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </FormField>

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
