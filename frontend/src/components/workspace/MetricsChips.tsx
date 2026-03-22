import { useEffect, useMemo, useRef } from "react";
import { ChipGroup } from "./ChipGroup";
import { CompactStepper } from "./CompactStepper";
import { METRICS_BY_TASK } from "./constants";

interface ConditionalParamDef {
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}

interface MetricsChipsProps {
  task: string;
  selectedMetrics: string[];
  onChange: (metrics: string[]) => void;
  metricsByTask?: Record<string, string[]>;
  conditionalParams?: Record<string, ConditionalParamDef>;
  paramValues?: Record<string, number>;
  onParamChange?: (metric: string, value: number) => void;
}

export function MetricsChips({
  task,
  selectedMetrics,
  onChange,
  metricsByTask,
  conditionalParams,
  paramValues,
  onParamChange,
}: MetricsChipsProps) {
  // Merge backend option_sets with fallback constants
  // Default: ALL metrics enabled for the task
  const effectiveMetrics = useMemo(() => {
    if (metricsByTask?.[task]) {
      const available = metricsByTask[task];
      return { available, defaults: [...available] };
    }
    const fallback = METRICS_BY_TASK[task];
    if (fallback) {
      return {
        available: fallback.available,
        defaults: [...fallback.available],
      };
    }
    return { available: [], defaults: [] };
  }, [task, metricsByTask]);

  const prevTask = useRef(task);

  // Reset to defaults when task changes
  useEffect(() => {
    if (task !== prevTask.current) {
      prevTask.current = task;
      if (effectiveMetrics.defaults.length > 0) {
        onChange([...effectiveMetrics.defaults]);
      }
    }
  }, [task, onChange, effectiveMetrics]);

  if (effectiveMetrics.available.length === 0) return null;

  // Determine which conditional param inputs to render
  const activeConditionalParams =
    conditionalParams != null
      ? Object.entries(conditionalParams).filter(([metric]) =>
          selectedMetrics.includes(metric),
        )
      : [];

  return (
    <div className="flex flex-col gap-2">
      <ChipGroup
        options={effectiveMetrics.available}
        selected={selectedMetrics}
        onChange={onChange}
        minSelected={1}
      />

      {activeConditionalParams.map(([metric, def]) => {
        const currentValue = paramValues?.[metric] ?? def.default;
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
                if (v !== undefined && onParamChange) {
                  onParamChange(metric, v);
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
