import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { SearchSpaceCatalogEntry } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KNOWN_PARAMS, RANGE_DEFAULTS } from "./constants";
import { NumberInput } from "./NumberInput";

interface SpaceEntry {
  type: "float" | "int" | "categorical";
  low?: number;
  high?: number;
  log?: boolean;
  step?: number;
  choices?: string[];
}

interface SearchSpaceTableProps {
  space: Record<string, unknown>;
  modelParams: Record<string, unknown>;
  onChange: (space: Record<string, unknown>) => void;
  catalog?: SearchSpaceCatalogEntry[];
  stepMap?: Record<string, number>;
}

function toSpaceEntry(raw: unknown): SpaceEntry | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  // Handle categorical entries
  if (obj.type === "categorical") {
    return {
      type: "categorical",
      choices: Array.isArray(obj.choices) ? (obj.choices as string[]) : [],
    };
  }
  // Handle numeric range entries
  if (typeof obj.low !== "number" || typeof obj.high !== "number")
    return undefined;
  return {
    type: (obj.type as "float" | "int") ?? "float",
    low: obj.low,
    high: obj.high,
    log: (obj.log as boolean) ?? false,
    step: typeof obj.step === "number" ? obj.step : undefined,
  };
}

function formatSummary(entry: SpaceEntry): string {
  const dist = entry.log ? " (log)" : "";
  return `${entry.low} ~ ${entry.high}${dist}`;
}

export function SearchSpaceTable({
  space,
  modelParams,
  onChange,
  catalog,
  stepMap,
}: SearchSpaceTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Use backend catalog when available, fall back to KNOWN_PARAMS
  const effectiveCatalog = useMemo(() => {
    if (catalog) {
      return catalog.map((c) => ({
        key: c.key,
        type:
          c.paramType === "integer"
            ? ("integer" as const)
            : c.paramType === "number"
              ? ("float" as const)
              : ("float" as const),
        default: 0,
        description: c.title,
        modes: c.modes,
      }));
    }
    return KNOWN_PARAMS.map((kp) => ({
      ...kp,
      modes: ["fixed", "range"],
    }));
  }, [catalog]);

  const toggleExpand = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getMode = (key: string): "fixed" | "range" | "choice" => {
    const entry = space[key] as SpaceEntry | undefined;
    if (!entry) return "fixed";
    if (entry.type === "categorical") return "choice";
    return "range";
  };

  // Get available options for Choice mode from model params or known values
  const getChoiceOptions = useCallback(
    (key: string): string[] => {
      // For boolean params
      const param = effectiveCatalog.find((p) => p.key === key);
      if (param?.type === "integer" || param?.type === "float") return [];
      // Known categorical options
      const knownOptions: Record<string, string[]> = {
        objective: [
          "binary",
          "cross_entropy",
          "huber",
          "mse",
          "mae",
          "multiclass",
        ],
        metric: ["auc", "logloss", "rmse", "mae", "accuracy"],
        first_metric_only: ["true", "false"],
      };
      return knownOptions[key] ?? [];
    },
    [effectiveCatalog],
  );

  const handleModeChange = (key: string, mode: string) => {
    if (mode === "range") {
      const defaults = RANGE_DEFAULTS[key] ?? { low: 0, high: 1, log: false };
      const param = effectiveCatalog.find((p) => p.key === key);
      const entry: SpaceEntry = {
        type: param?.type === "integer" ? "int" : "float",
        low: defaults.low,
        high: defaults.high,
        log: defaults.log,
        step: defaults.step ?? stepMap?.[key],
      };
      onChange({ ...space, [key]: entry });
    } else if (mode === "choice") {
      const entry: SpaceEntry = {
        type: "categorical",
        choices: [],
      };
      onChange({ ...space, [key]: entry });
    } else {
      // Switch to fixed — remove from space
      const { [key]: _, ...rest } = space;
      onChange(rest);
      setExpandedRows((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const updateEntry = (key: string, patch: Partial<SpaceEntry>) => {
    const current = toSpaceEntry(space[key]);
    if (!current) return;
    const updated = { ...current, ...patch };
    onChange({ ...space, [key]: updated });
  };

  const handleDistributionChange = (key: string, value: string) => {
    updateEntry(key, { log: value === "log-uniform" });
  };

  return (
    <div className="rounded-md border">
      {/* Header */}
      <div className="flex items-center border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <span className="w-6" />
        <span className="flex-1">Parameter</span>
        <span className="w-24 text-center">Mode</span>
        <span className="flex-1 text-right">Summary</span>
      </div>

      {/* Rows */}
      {effectiveCatalog.map((param) => {
        const mode = getMode(param.key);
        const entry = toSpaceEntry(space[param.key]);
        const isExpanded = expandedRows.has(param.key);
        const isRange = mode === "range";
        const isChoice = mode === "choice";
        const isExpandable = isRange || isChoice;
        const isInteger = param.type === "integer";
        const availableModes = param.modes ?? ["fixed", "range"];

        return (
          <div key={param.key} className="border-b last:border-b-0">
            {/* Summary line */}
            <button
              type="button"
              className="flex w-full items-center px-3 py-2 hover:bg-muted/30 cursor-pointer text-left"
              onClick={() => isExpandable && toggleExpand(param.key)}
            >
              {/* Expand icon */}
              <span className="w-6 flex-shrink-0">
                {isExpandable &&
                  (isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 mr-1.5 transition-transform" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 mr-1.5 transition-transform" />
                  ))}
              </span>

              {/* Param name */}
              <span className="flex-1 text-xs font-mono">{param.key}</span>

              {/* Mode select */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation needed */}
              <div
                className="w-24"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Select
                  value={mode}
                  onValueChange={(v) => handleModeChange(param.key, v)}
                >
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModes.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Summary text */}
              <span className="flex-1 text-right text-xs text-muted-foreground tabular-nums">
                {isRange && entry
                  ? formatSummary(entry)
                  : isChoice && entry?.choices
                    ? entry.choices.join(", ")
                    : String(modelParams[param.key] ?? "default")}
              </span>
            </button>

            {/* Expanded detail */}
            {isRange && isExpanded && entry && (
              <div className="px-6 py-2 bg-muted/20 space-y-2">
                {/* min */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground w-20">
                    Min
                  </Label>
                  <NumberInput
                    value={entry.low}
                    onChange={(v) => updateEntry(param.key, { low: v ?? 0 })}
                    step={isInteger ? 1 : 0.001}
                  />
                </div>

                {/* max */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground w-20">
                    Max
                  </Label>
                  <NumberInput
                    value={entry.high}
                    onChange={(v) => updateEntry(param.key, { high: v ?? 0 })}
                    step={isInteger ? 1 : 0.001}
                  />
                </div>

                {/* distribution */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground w-20">
                    Distribution
                  </Label>
                  <Select
                    value={entry.log ? "log-uniform" : "uniform"}
                    onValueChange={(v) =>
                      handleDistributionChange(param.key, v)
                    }
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="uniform">Uniform</SelectItem>
                      <SelectItem value="log-uniform">Log-uniform</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* step (integer params only) */}
                {isInteger && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground w-20">
                      Step
                    </Label>
                    <NumberInput
                      value={entry.step}
                      onChange={(v) => updateEntry(param.key, { step: v })}
                      min={1}
                      step={1}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Choice mode expansion */}
            {isChoice && isExpanded && entry && (
              <div className="px-6 py-2 bg-muted/20">
                <div className="flex flex-wrap gap-1.5">
                  {getChoiceOptions(param.key).map((opt) => {
                    const selected = entry.choices?.includes(opt) ?? false;
                    return (
                      <Badge
                        key={opt}
                        variant={selected ? "default" : "outline"}
                        className="cursor-pointer text-xs"
                        onClick={() => {
                          const current = entry.choices ?? [];
                          const next = selected
                            ? current.filter((c) => c !== opt)
                            : [...current, opt];
                          updateEntry(param.key, { choices: next });
                        }}
                      >
                        {opt}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
