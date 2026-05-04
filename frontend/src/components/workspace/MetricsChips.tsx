import { useEffect, useMemo, useRef } from "react";
import type { MetricEntry } from "@/api/types";
import { metricEntryName } from "@/api/types";
import { ChipGroup } from "./ChipGroup";
import { CompactStepper } from "./CompactStepper";

interface ConditionalParamDef {
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}

interface MetricsChipsProps {
  task: string;
  /** Current metric entries — may contain plain strings or parameterised dicts. */
  selectedMetrics: MetricEntry[];
  onChange: (metrics: MetricEntry[]) => void;
  metricsByTask?: Record<string, string[]>;
  conditionalParams?: Record<string, ConditionalParamDef>;
}

/**
 * Extract the set of selected metric names from a MetricEntry array.
 */
function selectedNames(entries: MetricEntry[]): string[] {
  return entries.map(metricEntryName);
}

/**
 * Get param value for a parameterised metric from the entries list.
 */
function getParamValue(
  entries: MetricEntry[],
  metric: string,
  paramKey: string,
  fallback: number,
): number {
  for (const entry of entries) {
    if (typeof entry !== "string" && metric in entry) {
      const val = entry[metric][paramKey];
      return typeof val === "number" ? val : fallback;
    }
  }
  return fallback;
}

export function MetricsChips({
  task,
  selectedMetrics,
  onChange,
  metricsByTask,
  conditionalParams,
}: MetricsChipsProps) {
  // Metric catalog is backend-driven via UiSchema option_sets.metric.
  // Default on task change: ALL metrics enabled for the task.
  const available = useMemo(
    () => metricsByTask?.[task] ?? [],
    [task, metricsByTask],
  );

  const prevTask = useRef(task);

  // Reset to defaults when task changes or when no metrics are selected
  useEffect(() => {
    const taskChanged = task !== prevTask.current;
    prevTask.current = task;
    if ((taskChanged || selectedMetrics.length === 0) && available.length > 0) {
      onChange([...available]);
    }
  }, [task, onChange, available, selectedMetrics.length]);

  if (available.length === 0) return null;

  const names = selectedNames(selectedMetrics);

  // When chip selection changes, rebuild MetricEntry[] preserving params
  const handleChipChange = (newNames: string[]) => {
    const entries: MetricEntry[] = newNames.map((name) => {
      // If this metric already exists with params, preserve them
      const existing = selectedMetrics.find((e) => metricEntryName(e) === name);
      if (existing && typeof existing !== "string") return existing;

      // If this metric has conditional params, initialise with defaults
      if (conditionalParams?.[name]) {
        const def = conditionalParams[name];
        return { [name]: { k: def.default } };
      }
      return name;
    });
    onChange(entries);
  };

  // When a conditional param value changes, update the MetricEntry dict
  const handleParamChange = (metric: string, value: number) => {
    const updated = selectedMetrics.map((entry) => {
      if (metricEntryName(entry) === metric) {
        // Build/replace the parameterised entry
        const existing = typeof entry === "string" ? {} : (entry[metric] ?? {});
        return { [metric]: { ...existing, k: value } };
      }
      return entry;
    });
    onChange(updated);
  };

  // Determine which conditional param inputs to render
  const activeConditionalParams =
    conditionalParams != null
      ? Object.entries(conditionalParams).filter(([metric]) =>
          names.includes(metric),
        )
      : [];

  return (
    <div className="flex flex-col gap-2">
      <ChipGroup
        options={available}
        selected={names}
        onChange={handleChipChange}
        minSelected={1}
      />

      {activeConditionalParams.map(([metric, def]) => {
        const currentValue = getParamValue(
          selectedMetrics,
          metric,
          "k",
          def.default,
        );
        const inputId = `cond-param-${metric}`;
        return (
          <div key={metric} className="flex items-center gap-2">
            <label
              htmlFor={inputId}
              className="text-xs text-muted-foreground"
              style={{ minWidth: "var(--form-label-width, 90px)" }}
            >
              {def.label}
            </label>
            <CompactStepper
              inputId={inputId}
              value={currentValue}
              onChange={(v) => {
                if (v !== undefined) {
                  handleParamChange(metric, v);
                }
              }}
              min={def.min}
              max={def.max}
              step={def.step ?? 1}
            />
          </div>
        );
      })}
    </div>
  );
}
