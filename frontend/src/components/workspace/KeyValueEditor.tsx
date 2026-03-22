import { Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { ParameterHint } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KNOWN_PARAMS } from "./constants";
import { NumberInput } from "./NumberInput";

interface KeyValueEditorProps {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  modelName: string;
  parameterHints?: ParameterHint[];
  shouldShowField?: (key: string) => boolean;
  additionalParams?: string[];
  stepMap?: Record<string, number>;
}

interface CustomRow {
  id: string;
  key: string;
  value: string;
}

function makeId(): string {
  return crypto.randomUUID();
}

export function KeyValueEditor({
  params,
  onChange,
  modelName,
  parameterHints,
  shouldShowField,
  additionalParams,
  stepMap,
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
    (updates: Record<string, number | undefined>, customs: CustomRow[]) => {
      const result: Record<string, unknown> = {};
      // Preserve non-preset params from current config
      for (const [k, v] of Object.entries(params)) {
        const isPreset = effectiveParams.some((p) => p.key === k);
        const isCustom = customs.some((c) => c.key.trim() === k);
        if (!isPreset && !isCustom) {
          result[k] = v;
        }
      }
      // Preset values
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) {
          result[k] = v;
        }
      }
      // Custom values
      for (const row of customs) {
        if (row.key.trim() && row.value.trim()) {
          const num = Number(row.value);
          result[row.key.trim()] = Number.isNaN(num) ? row.value : num;
        }
      }
      onChange(result);
    },
    [onChange, params, effectiveParams],
  );

  const handlePresetChange = (key: string, value: number | undefined) => {
    const updates: Record<string, number | undefined> = {};
    for (const kp of effectiveParams) {
      const v = params[kp.key];
      updates[kp.key] = v !== undefined && v !== null ? Number(v) : undefined;
    }
    updates[key] = value;
    emitChange(updates, customRows);
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
    const presets: Record<string, number | undefined> = {};
    for (const kp of effectiveParams) {
      const v = params[kp.key];
      presets[kp.key] = v !== undefined && v !== null ? Number(v) : undefined;
    }
    emitChange(presets, updated);
  };

  const addCustomRow = () => {
    setCustomRows((prev) => [...prev, { id: makeId(), key: "", value: "" }]);
  };

  const removeCustomRow = (idx: number) => {
    const updated = customRows.filter((_, i) => i !== idx);
    setCustomRows(updated);
    const presets: Record<string, number | undefined> = {};
    for (const kp of effectiveParams) {
      const v = params[kp.key];
      presets[kp.key] = v !== undefined && v !== null ? Number(v) : undefined;
    }
    emitChange(presets, updated);
  };

  // Catalog-driven additional params: entries already present in params
  const catalogEntries = useMemo(() => {
    if (!additionalParams) return [];
    const presetKeys = new Set(effectiveParams.map((p) => p.key));
    return additionalParams.filter(
      (key) => !presetKeys.has(key) && params[key] !== undefined,
    );
  }, [additionalParams, effectiveParams, params]);

  // Available catalog params not yet added
  const availableCatalogParams = useMemo(() => {
    if (!additionalParams) return [];
    const presetKeys = new Set(effectiveParams.map((p) => p.key));
    const usedKeys = new Set(Object.keys(params));
    return additionalParams.filter(
      (key) => !presetKeys.has(key) && !usedKeys.has(key),
    );
  }, [additionalParams, effectiveParams, params]);

  const handleCatalogAdd = (key: string) => {
    const step = stepMap?.[key] ?? 1;
    onChange({ ...params, [key]: step });
  };

  const handleCatalogChange = (key: string, value: number | undefined) => {
    if (value === undefined) {
      const { [key]: _, ...rest } = params;
      onChange(rest);
    } else {
      onChange({ ...params, [key]: value });
    }
  };

  const handleCatalogRemove = (key: string) => {
    const { [key]: _, ...rest } = params;
    onChange(rest);
  };

  const label =
    modelName === "lgbm" ? "LightGBM params" : `${modelName} params`;

  return (
    <div>
      <p className="text-sm text-muted-foreground font-medium mb-2">{label}</p>

      {/* Preset parameter rows — using NumberInput for ± stepper */}
      <div className="space-y-1.5">
        {effectiveParams
          .filter((kp) => !shouldShowField || shouldShowField(kp.key))
          .map((kp) => {
            const value = params[kp.key];
            const numValue =
              value !== undefined && value !== null ? Number(value) : undefined;
            const step = kp.step ?? (kp.type === "integer" ? 1 : 0.01);
            return (
              <div key={kp.key} className="flex items-center gap-2">
                <span className="text-sm font-mono w-36 truncate text-muted-foreground">
                  {kp.key}
                </span>
                <NumberInput
                  value={numValue}
                  onChange={(v) => handlePresetChange(kp.key, v)}
                  step={step}
                  placeholder={String(kp.default)}
                />
              </div>
            );
          })}
      </div>

      {/* Catalog-driven additional params */}
      {additionalParams ? (
        <div className="mt-2 space-y-1.5">
          {catalogEntries.map((key) => {
            const value = params[key];
            const numValue =
              value !== undefined && value !== null ? Number(value) : undefined;
            const step = stepMap?.[key] ?? 1;
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-sm font-mono w-36 truncate text-muted-foreground">
                  {key}
                </span>
                <NumberInput
                  value={numValue}
                  onChange={(v) => handleCatalogChange(key, v)}
                  step={step}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleCatalogRemove(key)}
                  type="button"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}

          {availableCatalogParams.length > 0 && (
            <Select onValueChange={handleCatalogAdd}>
              <SelectTrigger className="h-7 w-48 text-xs mt-1">
                <div className="flex items-center gap-1">
                  <Plus className="h-3 w-3" />
                  <SelectValue placeholder="Add parameter..." />
                </div>
              </SelectTrigger>
              <SelectContent>
                {availableCatalogParams.map((key) => (
                  <SelectItem
                    key={key}
                    value={key}
                    className="text-xs font-mono"
                  >
                    {key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : (
        <>
          {/* Free-form custom parameter rows (fallback) */}
          {customRows.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {customRows.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    className="h-7 w-36 text-xs font-mono"
                    value={row.key}
                    placeholder="param name"
                    onChange={(e) =>
                      handleCustomChange(i, "key", e.target.value)
                    }
                  />
                  <Input
                    className="h-7 w-24 text-xs text-right tabular-nums"
                    value={row.value}
                    placeholder="value"
                    onChange={(e) =>
                      handleCustomChange(i, "value", e.target.value)
                    }
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
        </>
      )}
    </div>
  );
}
