import { useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { METRICS_BY_TASK } from "./constants";
import { NumberInput } from "./NumberInput";

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

  const toggleMetric = (metric: string) => {
    const isSelected = selectedMetrics.includes(metric);
    if (isSelected) {
      if (selectedMetrics.length <= 1) return;
      onChange(selectedMetrics.filter((m) => m !== metric));
    } else {
      onChange([...selectedMetrics, metric]);
    }
  };

  // Determine which conditional param inputs to render
  const activeConditionalParams =
    conditionalParams != null
      ? Object.entries(conditionalParams).filter(([metric]) =>
          selectedMetrics.includes(metric),
        )
      : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {effectiveMetrics.available.map((metric) => {
          const selected = selectedMetrics.includes(metric);
          return (
            <button
              key={metric}
              type="button"
              onClick={() => toggleMetric(metric)}
            >
              <Badge
                variant={selected ? "default" : "outline"}
                className="cursor-pointer text-xs"
              >
                {metric}
              </Badge>
            </button>
          );
        })}
      </div>

      {activeConditionalParams.map(([metric, def]) => {
        const currentValue = paramValues?.[metric] ?? def.default;
        return (
          <div key={metric} className="flex items-center gap-2">
            <label
              htmlFor={`param-${metric}`}
              className="text-xs text-muted-foreground"
            >
              {def.label}
            </label>
            <NumberInput
              id={`param-${metric}`}
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
