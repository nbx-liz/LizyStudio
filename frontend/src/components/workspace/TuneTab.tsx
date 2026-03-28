import { useCallback, useMemo } from "react";
import type { MetricEntry } from "@/api/types";
import { metricEntryName } from "@/api/types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { CompactStepper } from "./CompactStepper";
import { SearchSpaceTable } from "./SearchSpaceTable";
import { SegmentGroup } from "./SegmentGroup";
import { TuneSettings } from "./TuneSettings";

interface TuneTabProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  task: string | null;
  uiSchema?: import("@/api/types").UiSchema;
}

function updateTuningConfig(
  config: Record<string, unknown>,
  path: "params" | "space" | "evaluation",
  value: unknown,
): Record<string, unknown> {
  const tuning = (config.tuning as Record<string, unknown>) ?? {};
  const optuna = (tuning.optuna as Record<string, unknown>) ?? {};
  return {
    ...config,
    tuning: { ...tuning, optuna: { ...optuna, [path]: value } },
  };
}

function extractOptunaField<T>(
  config: Record<string, unknown>,
  field: string,
  fallback: T,
): T {
  const tuning = config.tuning as Record<string, unknown> | undefined;
  const optuna = tuning?.optuna as Record<string, unknown> | undefined;
  return (optuna?.[field] as T) ?? fallback;
}

export function TuneTab({ config, onChange, task, uiSchema }: TuneTabProps) {
  const tuningParams = extractOptunaField<{
    n_trials?: number;
    timeout?: number | null;
  }>(config, "params", {});

  const searchSpace = extractOptunaField<Record<string, unknown>>(
    config,
    "space",
    {},
  );

  const evaluation = extractOptunaField<{
    metrics?: MetricEntry[];
  }>(config, "evaluation", {});

  const modelSection = (config.model as Record<string, unknown>) ?? {};
  const modelParams = (modelSection.params as Record<string, unknown>) ?? {};

  // Metric options for the current task (used for optimization + additional metrics)
  const metricOptions = useMemo(() => {
    if (!task) return [];
    const opts = uiSchema?.option_sets?.metric;
    if (opts?.[task]) return opts[task];
    return [];
  }, [task, uiSchema]);

  // metric_direction map for auto direction
  const metricDirection = useMemo(() => {
    return uiSchema?.metric_direction;
  }, [uiSchema]);

  // Objective options for task
  const objectiveOptions = useMemo(() => {
    if (!task) return [];
    const opts = uiSchema?.option_sets?.objective;
    if (opts?.[task]) return opts[task];
    return [];
  }, [task, uiSchema]);

  // Model metric options (for search space catalog metric choices)
  const modelMetricOptions = useMemo(() => {
    if (!task) return [];
    const opts = uiSchema?.option_sets?.model_metric;
    if (opts?.[task]) return opts[task];
    return [];
  }, [task, uiSchema]);

  // Per-parameter option sets derived from uiSchema.option_sets for generic choice mode.
  // Each key in option_sets whose value is a flat string[] is passed through directly;
  // task-keyed nested records are resolved for the current task.
  const paramOptionSets = useMemo((): Record<string, string[]> => {
    if (!uiSchema?.option_sets) return {};
    const result: Record<string, string[]> = {};
    for (const [paramKey, value] of Object.entries(uiSchema.option_sets)) {
      if (Array.isArray(value)) {
        // Flat string[] — task-independent options
        result[paramKey] = value as string[];
      } else if (task && typeof value === "object" && value !== null) {
        // Nested Record<task, string[]> — resolve for current task
        const taskMap = value as Record<string, string[]>;
        if (taskMap[task]) {
          result[paramKey] = taskMap[task];
        }
      }
    }
    return result;
  }, [task, uiSchema]);

  // Current evaluation metrics from config (may contain MetricEntry dicts)
  const evalMetrics = evaluation.metrics ?? [];
  const optimizationMetric = evalMetrics[0]
    ? metricEntryName(evalMetrics[0])
    : "";
  const additionalMetricNames = evalMetrics.slice(1).map(metricEntryName);

  // Auto-determine direction from metric_direction mapping
  const autoDirection = useMemo(() => {
    if (!task || !optimizationMetric || !metricDirection) return "";
    const taskDirs = metricDirection[task];
    if (!taskDirs) return "minimize";
    return taskDirs[optimizationMetric] ?? "minimize";
  }, [task, optimizationMetric, metricDirection]);

  const handleParamsChange = (params: Record<string, unknown>) => {
    onChange(updateTuningConfig(config, "params", params));
  };

  const handleSpaceChange = (space: Record<string, unknown>) => {
    onChange(updateTuningConfig(config, "space", space));
  };

  const handleModelParamChange = useCallback(
    (key: string, value: unknown) => {
      const newParams = { ...modelParams, [key]: value };
      const model = (config.model as Record<string, unknown>) ?? {};
      onChange({ ...config, model: { ...model, params: newParams } });
    },
    [config, modelParams, onChange],
  );

  // Build a MetricEntry — use dict form for precision_at_k
  const buildEntry = useCallback((name: string, k?: number): MetricEntry => {
    if (name === "precision_at_k") {
      return { precision_at_k: { k: k ?? 10 } };
    }
    return name;
  }, []);

  // Get precision_at_k k-value from current tune evaluation metrics
  const tuneKValue = useMemo(() => {
    for (const entry of evalMetrics) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "precision_at_k" in entry
      ) {
        const k = entry.precision_at_k?.k;
        return typeof k === "number" ? k : 10;
      }
    }
    return 10;
  }, [evalMetrics]);

  const handleOptimizationMetricChange = useCallback(
    (metric: string) => {
      // Set as first metric, keep additional metrics that aren't the new optimization metric
      const filtered = evalMetrics
        .slice(1)
        .filter((e) => metricEntryName(e) !== metric);
      const newEval = {
        ...evaluation,
        metrics: [buildEntry(metric), ...filtered],
      };
      // Also set direction in params
      const dir = (() => {
        if (!task || !metricDirection) return "minimize";
        const taskDirs = metricDirection[task];
        return taskDirs?.[metric] ?? "minimize";
      })();
      const newParams = { ...tuningParams, metric, direction: dir };
      const tuning = (config.tuning as Record<string, unknown>) ?? {};
      const optuna = (tuning.optuna as Record<string, unknown>) ?? {};
      onChange({
        ...config,
        tuning: {
          ...tuning,
          optuna: { ...optuna, evaluation: newEval, params: newParams },
        },
      });
    },
    [
      evalMetrics,
      evaluation,
      buildEntry,
      config,
      task,
      metricDirection,
      tuningParams,
      onChange,
    ],
  );

  const handleAdditionalMetricsChange = useCallback(
    (metric: string) => {
      const isSelected = additionalMetricNames.includes(metric);
      const newAdditional = isSelected
        ? evalMetrics.slice(1).filter((e) => metricEntryName(e) !== metric)
        : [...evalMetrics.slice(1), buildEntry(metric)];
      const newEval = {
        ...evaluation,
        metrics: [
          evalMetrics[0] ?? optimizationMetric,
          ...newAdditional,
        ].filter(Boolean),
      };
      onChange(updateTuningConfig(config, "evaluation", newEval));
    },
    [
      additionalMetricNames,
      evalMetrics,
      evaluation,
      optimizationMetric,
      buildEntry,
      config,
      onChange,
    ],
  );

  // Handle k-value change for precision_at_k in tune evaluation
  const handleTuneKChange = useCallback(
    (k: number) => {
      const newMetrics = evalMetrics.map((entry) => {
        if (metricEntryName(entry) === "precision_at_k") {
          return { precision_at_k: { k } };
        }
        return entry;
      });
      const newEval = { ...evaluation, metrics: newMetrics };
      onChange(updateTuningConfig(config, "evaluation", newEval));
    },
    [evalMetrics, evaluation, config, onChange],
  );

  // Available metrics for Additional Metrics (exclude optimization metric)
  const additionalMetricOptions = useMemo(
    () => metricOptions.filter((m) => m !== optimizationMetric),
    [metricOptions, optimizationMetric],
  );

  return (
    <Accordion
      type="multiple"
      defaultValue={["settings", "search-space", "evaluation"]}
    >
      <TuneSettings
        tuningParams={tuningParams}
        onChange={handleParamsChange}
        nTrialsPresets={uiSchema?.n_trials_presets}
      />
      <AccordionItem value="search-space" className="border-b">
        <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
          Search Space
        </AccordionTrigger>
        <AccordionContent>
          <div className="pl-[18px]">
            <SearchSpaceTable
              space={searchSpace}
              modelParams={modelParams}
              onChange={handleSpaceChange}
              catalog={uiSchema?.search_space_catalog}
              stepMap={uiSchema?.step_map}
              task={task}
              objectiveOptions={objectiveOptions}
              metricOptions={modelMetricOptions}
              additionalParams={uiSchema?.additional_params}
              paramOptionSets={paramOptionSets}
              onModelParamChange={handleModelParamChange}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="evaluation" className="border-b">
        <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
          Evaluation
        </AccordionTrigger>
        <AccordionContent>
          <div className="lzs-form space-y-1.5 pl-[18px] px-1">
            {/* Optimization Metric */}
            {task && metricOptions.length > 0 && (
              <div>
                <Label className="text-sm text-muted-foreground mb-1.5 block">
                  Optimization Metric
                </Label>
                <SegmentGroup
                  options={metricOptions}
                  value={optimizationMetric}
                  onChange={handleOptimizationMetricChange}
                />
                {optimizationMetric && autoDirection && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-xs text-muted-foreground">
                      Direction:
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {autoDirection}
                    </Badge>
                  </div>
                )}
              </div>
            )}

            {/* Additional Metrics */}
            {task &&
              additionalMetricOptions.length > 0 &&
              optimizationMetric && (
                <div>
                  <Label className="text-sm text-muted-foreground mb-1.5 block">
                    Additional Metrics
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {additionalMetricOptions.map((m) => {
                      const selected = additionalMetricNames.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleAdditionalMetricsChange(m)}
                        >
                          <Badge
                            variant={selected ? "default" : "outline"}
                            className="cursor-pointer text-xs"
                          >
                            {m}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* precision_at_k k-value input (H-0034) */}
            {evalMetrics.some(
              (e) => metricEntryName(e) === "precision_at_k",
            ) && (
              <div className="flex items-center gap-2 mt-1.5">
                <Label className="text-xs text-muted-foreground">k</Label>
                <CompactStepper
                  inputId="tune-precision-k"
                  value={tuneKValue}
                  onChange={(v) => {
                    if (v !== undefined) handleTuneKChange(v);
                  }}
                  min={1}
                  max={100}
                  step={1}
                />
              </div>
            )}

            {/* No task selected */}
            {!task && (
              <p className="text-xs text-muted-foreground">
                Select a task to configure evaluation metrics.
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
