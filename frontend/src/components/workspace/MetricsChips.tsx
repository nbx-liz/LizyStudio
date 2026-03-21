import { useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { METRICS_BY_TASK } from "./constants";

interface MetricsChipsProps {
  task: string;
  selectedMetrics: string[];
  onChange: (metrics: string[]) => void;
  metricsByTask?: Record<string, string[]>;
}

export function MetricsChips({
  task,
  selectedMetrics,
  onChange,
  metricsByTask,
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

  return (
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
  );
}
