import { Plus, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompactStepper } from "./CompactStepper";
import { FormRow } from "./FormRow";

interface KeyValueEditorProps {
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  modelName: string;
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
  additionalParams,
  stepMap,
}: KeyValueEditorProps) {
  const [customRows, setCustomRows] = useState<CustomRow[]>([]);
  const prevCustomKeysRef = useRef<Set<string>>(new Set());

  const emitCustom = useCallback(
    (customs: CustomRow[]) => {
      // Strip previously committed custom keys to avoid orphaned entries on rename
      const stripped = Object.fromEntries(
        Object.entries(params).filter(
          ([k]) => !prevCustomKeysRef.current.has(k),
        ),
      );
      // Add current custom keys
      const newKeys = new Set<string>();
      const result: Record<string, unknown> = { ...stripped };
      for (const row of customs) {
        const key = row.key.trim();
        if (key && row.value.trim()) {
          const num = Number(row.value);
          result[key] = Number.isNaN(num) ? row.value : num;
          newKeys.add(key);
        }
      }
      prevCustomKeysRef.current = newKeys;
      onChange(result);
    },
    [onChange, params],
  );

  const handleCustomChange = (
    idx: number,
    field: "key" | "value",
    val: string,
  ) => {
    const updated = customRows.map((r, i) =>
      i === idx ? { ...r, [field]: val } : r,
    );
    setCustomRows(updated);
    emitCustom(updated);
  };

  const addCustomRow = () => {
    setCustomRows((prev) => [...prev, { id: makeId(), key: "", value: "" }]);
  };

  const removeCustomRow = (idx: number) => {
    const removed = customRows[idx];
    const updated = customRows.filter((_, i) => i !== idx);
    setCustomRows(updated);
    // Also remove the key from params if it was set
    if (removed?.key.trim()) {
      const { [removed.key.trim()]: _, ...rest } = params;
      onChange(rest);
    }
  };

  // Catalog-driven additional params: entries already present in params
  const catalogEntries = useMemo(() => {
    if (!additionalParams) return [];
    return additionalParams.filter((key) => params[key] !== undefined);
  }, [additionalParams, params]);

  // Available catalog params not yet added
  const availableCatalogParams = useMemo(() => {
    if (!additionalParams) return [];
    const usedKeys = new Set(Object.keys(params));
    return additionalParams.filter((key) => !usedKeys.has(key));
  }, [additionalParams, params]);

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

      {/* Catalog-driven additional params */}
      {additionalParams ? (
        <div className="space-y-1.5">
          {catalogEntries.map((key) => {
            const value = params[key];
            const numValue =
              value !== undefined && value !== null ? Number(value) : undefined;
            const step = stepMap?.[key] ?? 1;
            return (
              <FormRow key={key} label={key}>
                <div className="flex items-center gap-1">
                  <CompactStepper
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
                    aria-label={`Remove ${key}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </FormRow>
            );
          })}

          {availableCatalogParams.length > 0 && (
            <Select onValueChange={handleCatalogAdd}>
              <SelectTrigger
                aria-label="Add parameter"
                className="h-7 w-48 text-xs mt-1"
              >
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
                    aria-label="Remove row"
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
