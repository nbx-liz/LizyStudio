import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { SearchSpaceCatalogEntry } from "@/api/types";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChoiceInput } from "./ChoiceInput";
import { FeatureWeightsEditor } from "./FeatureWeightsEditor";
import { FixedValueEditor } from "./FixedValueEditor";
import { NumberInput } from "./NumberInput";
import { SegmentGroup } from "./SegmentGroup";

const GROUP_LABELS: Record<string, string> = {
  model_params: "Model Params",
  smart_params: "Smart Params",
  training: "Training Params",
  additional: "Additional Params",
};

interface SpaceEntry {
  type: "float" | "int" | "categorical";
  low?: number;
  high?: number;
  log?: boolean;
  step?: number;
  choices?: string[];
  category?: string;
}

/** Map UI group name to LizyML search space category. */
export function groupToCategory(group: string): string {
  if (group === "smart_params") return "smart";
  if (group === "training") return "training";
  return "model";
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
  /** Per-parameter option sets for generic choice mode (keyed by param name). */
  paramOptionSets?: Record<string, string[]>;
  /** Called when the user edits a fixed-mode parameter value. */
  onModelParamChange?: (key: string, value: unknown) => void;
  /** Conditional visibility rules: {paramKey: {depKey: requiredValue}} */
  conditionalVisibility?: Record<string, Record<string, unknown>>;
  /** Special field rendering hints: {paramKey: "objective"|"model_metric"|...} */
  specialSearchSpaceFields?: Record<string, string>;
  /** Column names for feature_weights editor. */
  columns?: string[];
}

function toSpaceEntry(raw: unknown): SpaceEntry | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const category = typeof obj.category === "string" ? obj.category : undefined;
  if (obj.type === "categorical") {
    return {
      type: "categorical",
      choices: Array.isArray(obj.choices) ? (obj.choices as string[]) : [],
      category,
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
    category,
  };
}

/** Resolve a catalog default that may be task-keyed (e.g. {binary: "binary"}). */
function resolveCatalogDefault(
  raw: unknown,
  task: string | null | undefined,
): unknown {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (task && task in obj) return obj[task];
    // Task-keyed object but task unknown — don't guess
    return undefined;
  }
  return raw;
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
  task,
  objectiveOptions,
  metricOptions,
  additionalParams,
  paramOptionSets,
  onModelParamChange,
  conditionalVisibility,
  specialSearchSpaceFields,
  columns,
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
    if (!catalog) return [];
    return catalog.map((c) => ({
      key: c.key,
      type:
        c.paramType === "integer"
          ? ("integer" as const)
          : c.paramType === "boolean"
            ? ("boolean" as const)
            : ("float" as const),
      catalogDefault: c.default as unknown,
      description: c.title,
      modes: c.modes,
      paramType: c.paramType,
      group: c.group ?? "model_params",
      defaultRange: c.default_range,
    }));
  }, [catalog]);

  const fullCatalog = useMemo(() => {
    const extraEntries = addedParams
      .filter((p) => !effectiveCatalog.some((e) => e.key === p))
      .map((p) => ({
        key: p,
        type: "float" as const,
        catalogDefault: undefined as unknown,
        description: p,
        modes: ["fixed", "range"] as string[],
        paramType: "number",
        group: "additional",
        defaultRange: undefined as
          | { low: number; high: number; log: boolean }
          | undefined,
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
    (key: string): string[] | undefined => {
      // Per-parameter option sets take precedence
      if (paramOptionSets?.[key]) return paramOptionSets[key];
      if (key === "objective") return objectiveOptions ?? [];
      if (key === "metric") return metricOptions ?? [];
      // Boolean params always get true/false options (Widget conformance)
      const paramEntry = fullCatalog.find((p) => p.key === key);
      if (paramEntry?.paramType === "boolean") return ["true", "false"];
      // No known options — signal free-text mode
      return undefined;
    },
    [objectiveOptions, metricOptions, paramOptionSets, fullCatalog],
  );

  const handleModeChange = (key: string, mode: string) => {
    if (mode === "range") {
      const param = fullCatalog.find((p) => p.key === key);
      const defaults = param?.defaultRange ?? { low: 0, high: 1, log: false };
      const entry: SpaceEntry = {
        type: param?.type === "integer" ? "int" : "float",
        low: defaults.low,
        high: defaults.high,
        log: defaults.log,
        step: stepMap?.[key],
        category: groupToCategory(param?.group ?? "model_params"),
      };
      onChange({ ...space, [key]: entry });
      setExpandedRows((prev) => new Set([...prev, key]));
    } else if (mode === "choice") {
      const param = fullCatalog.find((p) => p.key === key);
      // Boolean params start with both options; others start empty
      const initChoices =
        param?.paramType === "boolean" ? ["true", "false"] : [];
      const entry: SpaceEntry = {
        type: "categorical",
        choices: initChoices,
        category: groupToCategory(param?.group ?? "model_params"),
      };
      onChange({ ...space, [key]: entry });
      setExpandedRows((prev) => new Set([...prev, key]));
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

  /** Check conditional visibility for a catalog entry (Widget conformance).
   * If dep is in space (Choice/Range), treat as satisfied.
   * Otherwise compare fixed value from modelParams, falling back to catalog default. */
  const isParamVisible = (key: string): boolean => {
    if (!conditionalVisibility) return true;
    const rule = conditionalVisibility[key];
    if (!rule) return true;
    for (const [depKey, required] of Object.entries(rule)) {
      if (depKey in space) continue; // dep in Choice/Range → treat as satisfied
      // Get current value: modelParams → catalog default
      let current = modelParams[depKey];
      if (current === undefined) {
        const depEntry = fullCatalog.find((c) => c.key === depKey);
        if (depEntry) {
          current = resolveCatalogDefault(depEntry.catalogDefault, task);
        }
      }
      // Support array values: e.g. {"task": ["binary"]} matches task="binary"
      const isMatch = Array.isArray(required)
        ? required.includes(current)
        : current === required;
      if (!isMatch) return false;
    }
    return true;
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
              <span className="text-sm text-muted-foreground font-medium">
                {GROUP_LABELS[group] ?? group}
              </span>
              <div className="flex-1 border-t border-muted-foreground/20" />
            </div>
          )}
          {items
            .filter((param) => isParamVisible(param.key))
            .map((param) => {
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

                    <span className="flex-1 text-xs font-mono">
                      {param.key}
                    </span>

                    {/* Mode segment buttons */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation needed */}
                    <div
                      className="w-32"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <SegmentGroup
                        options={availableModes}
                        value={mode}
                        onChange={(m) => handleModeChange(param.key, m)}
                        labels={Object.fromEntries(
                          availableModes.map((m) => [
                            m,
                            m.charAt(0).toUpperCase() + m.slice(1),
                          ]),
                        )}
                      />
                    </div>

                    {/* Summary / Fixed value editor */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation needed */}
                    <span
                      className="flex-1 flex justify-end text-xs text-muted-foreground tabular-nums"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {isRange && entry ? (
                        formatSummary(entry)
                      ) : isChoice && entry?.choices ? (
                        entry.choices.join(", ")
                      ) : onModelParamChange &&
                        specialSearchSpaceFields?.[param.key] ===
                          "objective" ? (
                        <SegmentGroup
                          options={objectiveOptions ?? []}
                          value={String(
                            modelParams[param.key] ??
                              resolveCatalogDefault(
                                param.catalogDefault,
                                task,
                              ) ??
                              "",
                          )}
                          onChange={(v) => onModelParamChange(param.key, v)}
                        />
                      ) : onModelParamChange &&
                        specialSearchSpaceFields?.[param.key] ===
                          "model_metric" ? (
                        <div className="flex flex-wrap gap-1">
                          {(metricOptions ?? []).map((opt) => {
                            const currentValue = modelParams[param.key];
                            const selected = Array.isArray(currentValue)
                              ? currentValue.includes(opt)
                              : false;
                            return (
                              <button
                                key={opt}
                                type="button"
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                  selected
                                    ? "bg-primary text-primary-foreground border-transparent"
                                    : "bg-transparent text-muted-foreground border-muted-foreground/30 hover:bg-muted"
                                }`}
                                onClick={() => {
                                  const cur = Array.isArray(currentValue)
                                    ? currentValue
                                    : [];
                                  const next = selected
                                    ? cur.filter((m: string) => m !== opt)
                                    : [...cur, opt];
                                  onModelParamChange(param.key, next);
                                }}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      ) : onModelParamChange && param.paramType === "object" ? (
                        <FeatureWeightsEditor
                          weights={
                            (modelParams[param.key] as Record<
                              string,
                              number
                            >) ?? null
                          }
                          columns={columns ?? []}
                          onChange={(v) => onModelParamChange(param.key, v)}
                        />
                      ) : onModelParamChange ? (
                        <FixedValueEditor
                          paramType={param.paramType}
                          value={
                            modelParams[param.key] ??
                            resolveCatalogDefault(param.catalogDefault, task)
                          }
                          onChange={(v) => onModelParamChange(param.key, v)}
                          step={stepMap?.[param.key]}
                          options={getChoiceOptions(param.key)}
                        />
                      ) : (
                        String(
                          modelParams[param.key] ??
                            resolveCatalogDefault(param.catalogDefault, task) ??
                            "default",
                        )
                      )}
                    </span>
                  </button>

                  {/* Range detail */}
                  {isRange && isExpanded && entry && (
                    <div className="px-6 py-2 bg-muted/20 space-y-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm text-muted-foreground w-20">
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
                        <Label className="text-sm text-muted-foreground w-20">
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
                        <Label className="text-sm text-muted-foreground w-20">
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
                          <Label className="text-sm text-muted-foreground w-20">
                            Step
                          </Label>
                          <NumberInput
                            value={entry.step}
                            onChange={(v) =>
                              updateEntry(param.key, { step: v })
                            }
                            min={1}
                            step={1}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Choice mode — ChoiceInput handles known options and free-text */}
                  {isChoice && isExpanded && entry && (
                    <div className="px-6 py-2 bg-muted/20">
                      <ChoiceInput
                        choices={entry.choices ?? []}
                        availableOptions={getChoiceOptions(param.key)}
                        onChange={(choices) =>
                          updateEntry(param.key, { choices })
                        }
                      />
                    </div>
                  )}

                  {/* precision_at_k k-value row — Fixed and Choice modes */}
                  {specialSearchSpaceFields?.[param.key] === "model_metric" &&
                    onModelParamChange &&
                    (() => {
                      // Fixed: check modelParams; Choice: check space choices
                      const fixedMetric = modelParams[param.key];
                      const choiceMetric = entry?.choices;
                      const hasPatK =
                        (mode === "fixed" &&
                          Array.isArray(fixedMetric) &&
                          fixedMetric.includes("precision_at_k")) ||
                        (mode === "choice" &&
                          Array.isArray(choiceMetric) &&
                          choiceMetric.includes("precision_at_k"));
                      if (!hasPatK) return null;
                      const kVal =
                        (modelParams._precision_at_k_k as number) ?? 10;
                      return (
                        <div className="flex items-center gap-2 px-6 py-1.5 border-t bg-muted/10">
                          <span className="text-xs font-mono text-muted-foreground">
                            precision_at_k: k
                          </span>
                          <NumberInput
                            value={kVal}
                            onChange={(v) =>
                              onModelParamChange("_precision_at_k_k", v ?? 10)
                            }
                            min={1}
                            max={100}
                            step={1}
                          />
                        </div>
                      );
                    })()}
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
