import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MetricEntry } from "@/api/types";
import { metricEntryName } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { CompactStepper } from "./CompactStepper";
import { SegmentGroup } from "./SegmentGroup";
import { updateTuningField } from "./tune-config-utils";

interface TuneEvaluationSectionProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  task: string | null;
  metricOptions: string[];
  metricDirection?: Record<string, Record<string, string>>;
  evaluation: { metrics?: MetricEntry[] };
  tuningParams: { n_trials?: number; timeout?: number | null };
}

/** Build a MetricEntry — use dict form for precision_at_k */
function buildEntry(name: string, k?: number): MetricEntry {
  if (name === "precision_at_k") {
    return { precision_at_k: { k: k ?? 10 } };
  }
  return name;
}

// P-0104 Wave 2.3 / Issue #459 — auto-populate defaults for fresh
// configs. Binary is the only task with a confirmed canonical set;
// regression / multiclass defaults are deferred to a follow-up issue
// per #459's scope statement.
const TASK_DEFAULT_METRICS: Record<string, string[]> = {
  binary: ["auc", "auc_pr", "brier", "logloss"],
};

export function TuneEvaluationSection({
  config,
  onChange,
  task,
  metricOptions,
  metricDirection,
  evaluation,
  tuningParams,
}: TuneEvaluationSectionProps) {
  // Current evaluation metrics from config
  const evalMetrics = evaluation.metrics ?? [];
  // Widget conformance: fall back to first available metric option
  const optimizationMetric = evalMetrics[0]
    ? metricEntryName(evalMetrics[0])
    : (metricOptions[0] ?? "");
  const additionalMetricNames = evalMetrics.slice(1).map(metricEntryName);

  // Auto-determine direction from metric_direction mapping
  const autoDirection = useMemo(() => {
    if (!task || !optimizationMetric || !metricDirection) return "";
    const taskDirs = metricDirection[task];
    if (!taskDirs) return "minimize";
    return taskDirs[optimizationMetric] ?? "minimize";
  }, [task, optimizationMetric, metricDirection]);

  // Bug 2026-04-14 defensive sync: keep ``optuna.params.direction`` in
  // step with ``autoDirection`` whenever the metric or task changes.
  // Without this, a user who never clicks a metric chip can leave the
  // config carrying a stale direction (the workspace inject path used
  // to hardcode ``minimize``, and the AUC class of metrics needs
  // ``maximize``). The backend ``_prepare_tune_config`` also reconciles
  // this server-side, but having the UI stay consistent avoids the
  // confusing case where the badge shows ``maximize`` while the raw
  // config dialog still shows ``minimize``.
  //
  // Implementation note: ``config`` and ``onChange`` are pulled through
  // refs so the effect's dep list can stay narrow (only the resolved
  // direction). Including ``config`` directly would re-fire on every
  // edit because we write back to ``config`` ourselves -> infinite loop.
  const configRef = useRef(config);
  const onChangeRef = useRef(onChange);
  configRef.current = config;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!autoDirection) return;
    const currentCfg = configRef.current;
    const tuning = (currentCfg.tuning as Record<string, unknown>) ?? {};
    const optuna = (tuning.optuna as Record<string, unknown>) ?? {};
    const params = (optuna.params as Record<string, unknown>) ?? {};
    if (params.direction === autoDirection) return;
    onChangeRef.current({
      ...currentCfg,
      tuning: {
        ...tuning,
        optuna: {
          ...optuna,
          params: { ...params, direction: autoDirection },
        },
      },
    });
  }, [autoDirection]);

  // P-0104 Wave 2.3 / Issue #459 — auto-populate the canonical default
  // metric set for fresh configs. Fires at most once per workspace; if
  // the user later clears the list explicitly we honor that and do not
  // re-seed (only an absent ``tuning.evaluation.metrics`` is treated as
  // "fresh"). Regression and multiclass are deferred until their
  // canonical defaults are confirmed in a follow-up.
  const defaultsSeededRef = useRef(false);
  useEffect(() => {
    if (defaultsSeededRef.current) return;
    if (!task) return;
    if (metricOptions.length === 0) return;
    // tuning.evaluation.metrics already set (even to []) -> user-owned,
    // don't re-seed.
    const currentCfg = configRef.current;
    const tuning = (currentCfg.tuning as Record<string, unknown>) ?? {};
    const ev = (tuning.evaluation as Record<string, unknown>) ?? {};
    if (Array.isArray(ev.metrics)) {
      defaultsSeededRef.current = true;
      return;
    }
    const defaults = TASK_DEFAULT_METRICS[task];
    if (!defaults) {
      defaultsSeededRef.current = true;
      return;
    }
    const available = defaults.filter((m) => metricOptions.includes(m));
    if (available.length === 0) {
      defaultsSeededRef.current = true;
      return;
    }
    const newMetrics: MetricEntry[] = available.map((m) => buildEntry(m));
    onChangeRef.current(
      updateTuningField(currentCfg, "evaluation", {
        ...ev,
        metrics: newMetrics,
      }),
    );
    defaultsSeededRef.current = true;
  }, [task, metricOptions]);

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
      // Set direction in optuna params (no "metric" key — Widget conformance)
      const dir = (() => {
        if (!task || !metricDirection) return "minimize";
        const taskDirs = metricDirection[task];
        return taskDirs?.[metric] ?? "minimize";
      })();
      const newParams = { ...tuningParams, direction: dir };
      // Update both: tuning.evaluation and tuning.optuna.params
      const tuning = (config.tuning as Record<string, unknown>) ?? {};
      const optuna = (tuning.optuna as Record<string, unknown>) ?? {};
      onChange({
        ...config,
        tuning: {
          ...tuning,
          evaluation: newEval,
          optuna: { ...optuna, params: newParams },
        },
      });
    },
    [
      evalMetrics,
      evaluation,
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
      const first = evalMetrics[0] ?? buildEntry(optimizationMetric);
      const newEval = {
        ...evaluation,
        metrics: [first, ...newAdditional].filter(Boolean),
      };
      onChange(updateTuningField(config, "evaluation", newEval));
    },
    [
      additionalMetricNames,
      evalMetrics,
      evaluation,
      optimizationMetric,
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
      onChange(updateTuningField(config, "evaluation", newEval));
    },
    [evalMetrics, evaluation, config, onChange],
  );

  // Available metrics for Additional Metrics (exclude optimization metric)
  const additionalMetricOptions = useMemo(
    () => metricOptions.filter((m) => m !== optimizationMetric),
    [metricOptions, optimizationMetric],
  );

  return (
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
              <span className="text-xs text-muted-foreground">Direction:</span>
              <Badge variant="secondary" className="text-xs">
                {autoDirection}
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Additional Metrics */}
      {task && additionalMetricOptions.length > 0 && optimizationMetric && (
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
      {evalMetrics.some((e) => metricEntryName(e) === "precision_at_k") && (
        <div className="flex items-center gap-2 mt-1.5">
          <Label
            htmlFor="tune-precision-k"
            className="text-xs text-muted-foreground"
          >
            k
          </Label>
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
  );
}
