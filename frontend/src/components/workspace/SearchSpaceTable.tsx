import { useCallback, useMemo, useState } from "react";
import type { SearchSpaceCatalogEntry } from "@/api/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchSpaceRow } from "./SearchSpaceRow";
import type { SpaceEntry } from "./search-space-utils";
import {
  GROUP_LABELS,
  groupToCategory,
  resolveCatalogDefault,
  toSpaceEntry,
} from "./search-space-utils";

// Re-export for backward compatibility
export { groupToCategory } from "./search-space-utils";

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
            .map((param) => (
              <SearchSpaceRow
                key={param.key}
                param={param}
                space={space}
                modelParams={modelParams}
                isExpanded={expandedRows.has(param.key)}
                onToggleExpand={toggleExpand}
                onModeChange={handleModeChange}
                onUpdateEntry={updateEntry}
                onDistributionChange={handleDistributionChange}
                getChoiceOptions={getChoiceOptions}
                stepMap={stepMap}
                task={task}
                objectiveOptions={objectiveOptions}
                metricOptions={metricOptions}
                onModelParamChange={onModelParamChange}
                specialSearchSpaceFields={specialSearchSpaceFields}
                columns={columns}
              />
            ))}
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
