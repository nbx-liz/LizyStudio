import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { SearchSpaceCatalogEntry } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const GROUP_LABELS: Record<string, string> = {
  model_params: "Model Params",
  smart_params: "Smart Params",
  additional: "Additional Params",
};

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
  task?: string | null;
  objectiveOptions?: string[];
  metricOptions?: string[];
  additionalParams?: string[];
}

function toSpaceEntry(raw: unknown): SpaceEntry | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.type === "categorical") {
    return {
      type: "categorical",
      choices: Array.isArray(obj.choices) ? (obj.choices as string[]) : [],
    };
  }
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
  task: _task,
  objectiveOptions,
  metricOptions,
  additionalParams,
}: SearchSpaceTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  // Initialize addedParams from space keys that exist in additionalParams
  // but not in the base catalog (survives remount)
  const [addedParams, setAddedParams] = useState<string[]>(() => {
    if (!additionalParams) return [];
    const catalogKeys = new Set((catalog ?? []).map((c) => c.key));
    return additionalParams.filter((p) => p in space && !catalogKeys.has(p));
  });

  const effectiveCatalog = useMemo(() => {
    if (catalog) {
      return catalog.map((c) => ({
        key: c.key,
        type:
          c.paramType === "integer"
            ? ("integer" as const)
            : c.paramType === "boolean"
              ? ("boolean" as const)
              : ("float" as const),
        default: 0,
        description: c.title,
        modes: c.modes,
        paramType: c.paramType,
        group: c.group ?? "model_params",
      }));
    }
    return KNOWN_PARAMS.map((kp) => ({
      ...kp,
      modes: ["fixed", "range"],
      paramType: kp.type === "integer" ? "integer" : "number",
      group: "model_params",
    }));
  }, [catalog]);

  const fullCatalog = useMemo(() => {
    const extraEntries = addedParams
      .filter((p) => !effectiveCatalog.some((e) => e.key === p))
      .map((p) => ({
        key: p,
        type: "float" as const,
        default: 0,
        description: p,
        modes: ["fixed", "range"] as string[],
        paramType: "number",
        group: "additional",
      }));
    return [...effectiveCatalog, ...extraEntries];
  }, [effectiveCatalog, addedParams]);

  const groupedCatalog = useMemo(() => {
    const groups: Array<{
      group: string;
      items: typeof fullCatalog;
    }> = [];
    const seen = new Set<string>();
    for (const item of fullCatalog) {
      const g = item.group;
      if (!seen.has(g)) {
        seen.add(g);
        groups.push({
          group: g,
          items: fullCatalog.filter((i) => i.group === g),
        });
      }
    }
    return groups;
  }, [fullCatalog]);

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

  const getChoiceOptions = useCallback(
    (key: string): string[] => {
      if (key === "objective") return objectiveOptions ?? [];
      if (key === "metric") return metricOptions ?? [];
      if (key === "first_metric_only" || key === "auto_num_leaves")
        return ["true", "false"];
      return [];
    },
    [objectiveOptions, metricOptions],
  );

  const handleModeChange = (key: string, mode: string) => {
    if (mode === "range") {
      const defaults = RANGE_DEFAULTS[key] ?? { low: 0, high: 1, log: false };
      const param = fullCatalog.find((p) => p.key === key);
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
        <span className="w-32 text-center">Mode</span>
        <span className="flex-1 text-right">Summary</span>
      </div>

      {/* Rows */}
      {groupedCatalog.map(({ group, items }) => (
        <div key={group}>
          {groupedCatalog.length > 1 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b">
              <span className="text-xs text-muted-foreground font-medium">
                {GROUP_LABELS[group] ?? group}
              </span>
              <div className="flex-1 border-t border-muted-foreground/20" />
            </div>
          )}
          {items.map((param) => {
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
                  <span className="w-6 flex-shrink-0">
                    {isExpandable &&
                      (isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 mr-1.5 transition-transform" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 mr-1.5 transition-transform" />
                      ))}
                  </span>

                  <span className="flex-1 text-xs font-mono">{param.key}</span>

                  {/* Mode segment buttons */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation needed */}
                  <div
                    className="w-32 flex gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {availableModes.map((m) => (
                      <Button
                        key={m}
                        variant={mode === m ? "default" : "outline"}
                        size="sm"
                        className="h-6 text-[10px] px-2 flex-1"
                        type="button"
                        onClick={() => handleModeChange(param.key, m)}
                      >
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </Button>
                    ))}
                  </div>

                  <span className="flex-1 text-right text-xs text-muted-foreground tabular-nums">
                    {isRange && entry
                      ? formatSummary(entry)
                      : isChoice && entry?.choices
                        ? entry.choices.join(", ")
                        : String(modelParams[param.key] ?? "default")}
                  </span>
                </button>

                {/* Range detail */}
                {isRange && isExpanded && entry && (
                  <div className="px-6 py-2 bg-muted/20 space-y-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-20">
                        Min
                      </Label>
                      <NumberInput
                        value={entry.low}
                        onChange={(v) =>
                          updateEntry(param.key, { low: v ?? 0 })
                        }
                        step={isInteger ? 1 : (stepMap?.[param.key] ?? 0.001)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-20">
                        Max
                      </Label>
                      <NumberInput
                        value={entry.high}
                        onChange={(v) =>
                          updateEntry(param.key, { high: v ?? 0 })
                        }
                        step={isInteger ? 1 : (stepMap?.[param.key] ?? 0.001)}
                      />
                    </div>
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
                          <SelectItem value="log-uniform">
                            Log-uniform
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
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

                {/* Choice mode — objective uses segment buttons, metric uses chips */}
                {isChoice && isExpanded && entry && (
                  <div className="px-6 py-2 bg-muted/20">
                    {param.key === "objective" ? (
                      /* Objective: segment buttons */
                      <div className="flex flex-wrap gap-1">
                        {getChoiceOptions(param.key).map((opt) => {
                          const selected =
                            entry.choices?.includes(opt) ?? false;
                          return (
                            <Button
                              key={opt}
                              variant={selected ? "default" : "outline"}
                              size="sm"
                              className="h-7 text-xs px-3"
                              type="button"
                              onClick={() => {
                                const current = entry.choices ?? [];
                                const next = selected
                                  ? current.filter((c) => c !== opt)
                                  : [...current, opt];
                                updateEntry(param.key, { choices: next });
                              }}
                            >
                              {opt}
                            </Button>
                          );
                        })}
                      </div>
                    ) : param.key === "metric" ? (
                      /* Metric: chips */
                      <div className="flex flex-wrap gap-1.5">
                        {getChoiceOptions(param.key).map((opt) => {
                          const selected =
                            entry.choices?.includes(opt) ?? false;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                const current = entry.choices ?? [];
                                const next = selected
                                  ? current.filter((c) => c !== opt)
                                  : [...current, opt];
                                updateEntry(param.key, { choices: next });
                              }}
                            >
                              <Badge
                                variant={selected ? "default" : "outline"}
                                className="cursor-pointer text-xs"
                              >
                                {opt}
                              </Badge>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      /* Other: chips */
                      <div className="flex flex-wrap gap-1.5">
                        {getChoiceOptions(param.key).map((opt) => {
                          const selected =
                            entry.choices?.includes(opt) ?? false;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                const current = entry.choices ?? [];
                                const next = selected
                                  ? current.filter((c) => c !== opt)
                                  : [...current, opt];
                                updateEntry(param.key, { choices: next });
                              }}
                            >
                              <Badge
                                variant={selected ? "default" : "outline"}
                                className="cursor-pointer text-xs"
                              >
                                {opt}
                              </Badge>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Add parameter */}
      {additionalParams &&
        additionalParams.length > 0 &&
        (() => {
          const usedKeys = new Set(fullCatalog.map((c) => c.key));
          const available = additionalParams.filter((p) => !usedKeys.has(p));
          if (available.length === 0) return null;
          return (
            <div className="px-3 py-2 border-t">
              <Select
                onValueChange={(v) => setAddedParams((prev) => [...prev, v])}
              >
                <SelectTrigger className="h-7 w-48 text-xs">
                  <SelectValue placeholder="+ Add parameter" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })()}
    </div>
  );
}
