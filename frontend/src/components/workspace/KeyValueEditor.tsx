import { Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { ParameterHint } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KNOWN_PARAMS } from "./constants";

interface KeyValueEditorProps {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  modelName: string;
  parameterHints?: ParameterHint[];
}

interface CustomRow {
  id: string;
  key: string;
  value: string;
}

let nextId = 0;
function makeId(): string {
  return `custom-${++nextId}`;
}

export function KeyValueEditor({
  params,
  onChange,
  modelName,
  parameterHints,
}: KeyValueEditorProps) {
  // Use backend hints when available, fall back to hardcoded constants
  const effectiveParams = useMemo(() => {
    if (!parameterHints) return KNOWN_PARAMS;
    return parameterHints
      .filter((h) => h.kind === "integer" || h.kind === "number")
      .map((h) => ({
        key: h.key,
        type: h.kind as "float" | "integer",
        default: 0,
        description: h.label,
        step: h.step,
      }));
  }, [parameterHints]);
  const [customRows, setCustomRows] = useState<CustomRow[]>([]);

  const emitChange = useCallback(
    (presetOverrides: Record<string, string>, customs: CustomRow[]) => {
      const result: Record<string, unknown> = {};
      // Preset values (non-empty only)
      for (const [k, v] of Object.entries(presetOverrides)) {
        if (v !== "") {
          const num = Number(v);
          result[k] = Number.isNaN(num) ? v : num;
        }
      }
      // Custom values (non-empty only)
      for (const row of customs) {
        if (row.key.trim() && row.value.trim()) {
          const num = Number(row.value);
          result[row.key.trim()] = Number.isNaN(num) ? row.value : num;
        }
      }
      onChange(result);
    },
    [onChange],
  );

  const handlePresetChange = (key: string, value: string) => {
    const current: Record<string, string> = {};
    for (const kp of effectiveParams) {
      const v = params[kp.key];
      current[kp.key] = v !== undefined && v !== null ? String(v) : "";
    }
    current[key] = value;
    emitChange(current, customRows);
  };

  const handleCustomChange = (
    idx: number,
    field: "key" | "value",
    val: string,
  ) => {
    const updated = customRows.map((r, i) =>
      i === idx ? { ...r, [field]: val } : r,
    );
    setCustomRows(updated);
    const presets: Record<string, string> = {};
    for (const kp of effectiveParams) {
      const v = params[kp.key];
      presets[kp.key] = v !== undefined && v !== null ? String(v) : "";
    }
    emitChange(presets, updated);
  };

  const addCustomRow = () => {
    setCustomRows((prev) => [...prev, { id: makeId(), key: "", value: "" }]);
  };

  const removeCustomRow = (idx: number) => {
    const updated = customRows.filter((_, i) => i !== idx);
    setCustomRows(updated);
    const presets: Record<string, string> = {};
    for (const kp of effectiveParams) {
      const v = params[kp.key];
      presets[kp.key] = v !== undefined && v !== null ? String(v) : "";
    }
    emitChange(presets, updated);
  };

  const label =
    modelName === "lgbm" ? "LightGBM params" : `${modelName} params`;

  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium mb-2">{label}</p>

      {/* Preset parameter rows */}
      <div className="space-y-1.5">
        {effectiveParams.map((kp) => {
          const value = params[kp.key];
          const strValue =
            value !== undefined && value !== null ? String(value) : "";
          return (
            <div key={kp.key} className="flex items-center gap-2">
              <span className="text-xs font-mono w-36 truncate text-muted-foreground">
                {kp.key}
              </span>
              <Input
                className="h-7 w-24 text-xs text-right tabular-nums"
                value={strValue}
                placeholder={String(kp.default)}
                onChange={(e) => handlePresetChange(kp.key, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      {/* Custom parameter rows */}
      {customRows.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {customRows.map((row, i) => (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                className="h-7 w-36 text-xs font-mono"
                value={row.key}
                placeholder="param name"
                onChange={(e) => handleCustomChange(i, "key", e.target.value)}
              />
              <Input
                className="h-7 w-24 text-xs text-right tabular-nums"
                value={row.value}
                placeholder="value"
                onChange={(e) => handleCustomChange(i, "value", e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => removeCustomRow(i)}
                type="button"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="mt-2 text-xs text-muted-foreground"
        onClick={addCustomRow}
        type="button"
      >
        <Plus className="mr-1 h-3 w-3" />
        Add parameter
      </Button>
    </div>
  );
}
