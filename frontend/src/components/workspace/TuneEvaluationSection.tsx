import { useCallback, useMemo } from "react";
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
  /**
   * P-0109 PR-6c: canonical fallback metric list for the current
   * task, sourced from ``GET /config/tuning-snapshot`` →
   * ``tuning_defaults.evaluation_metrics``. Replaces the
   * frontend-only ``TASK_DEFAULT_METRICS`` constant (P-0104 Wave 2.3
   * / Issue #459) that PR-5 left as a render-time fallback. Empty
   * when the snapshot has not loaded yet or the task has no canonical
   * default set (catalog returns ``[]`` for unknown tasks).
   */
  defaultEvaluationMetrics?: unknown[];
}

/** Build a MetricEntry — use dict form for precision_at_k */
function buildEntry(name: string, k?: number): MetricEntry {
  if (name === "precision_at_k") {
    return { precision_at_k: { k: k ?? 10 } };
  }
  return name;
}

/**
 * Coerce a snapshot ``evaluation_metrics`` entry into the local
 * MetricEntry union (``string | { [metric]: { ...params } }``). The
 * snapshot serialises both shapes verbatim, but the openapi-generated
 * type is ``unknown[]``; this helper narrows defensively so a stale /
 * mid-load snapshot does not crash the Tune-tab render.
 */
function coerceMetricEntry(value: unknown): MetricEntry | null {
  if (typeof value === "string") return value;
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  ) {
    return value as MetricEntry;
  }
  return null;
}

export function TuneEvaluationSection({
  config,
  onChange,
  task,
  metricOptions,
  metricDirection,
  evaluation,
  tuningParams,
  defaultEvaluationMetrics,
}: TuneEvaluationSectionProps) {
  // P-0109 PR-5 + PR-6c: derive effective evaluation metrics at render
  // time. The legacy "metrics seed useEffect" raced two siblings
  // (search-space init + direction defensive sync) through the
  // WriteFunnel; all three shared the ``config-form-edit`` reason and
  // the funnel coalesced them to the last-arriver, dropping the
  // metrics seed.
  //
  // The fix: keep the persisted ``evaluation.metrics`` as the source
  // of truth and fall back to ``defaultEvaluationMetrics`` — sourced
  // from ``GET /config/tuning-snapshot`` → ``tuning_defaults`` (PR-6c)
  // — when the user has not yet set anything. The first metric the
  // user explicitly clicks writes a real PUT through the funnel and
  // pins the list. The backend adapter owns the per-task canonical
  // list (INV-T5), so the frontend never carries an adapter-specific
  // branch.
  const persistedMetrics = evaluation.metrics;
  const evalMetrics: MetricEntry[] = useMemo(() => {
    if (Array.isArray(persistedMetrics) && persistedMetrics.length > 0) {
      return persistedMetrics;
    }
    if (!task || metricOptions.length === 0) return [];
    const fallback = defaultEvaluationMetrics ?? [];
    const out: MetricEntry[] = [];
    for (const raw of fallback) {
      const entry = coerceMetricEntry(raw);
      if (entry === null) continue;
      const name = metricEntryName(entry);
      if (!metricOptions.includes(name)) continue;
      out.push(entry);
    }
    return out;
  }, [persistedMetrics, task, metricOptions, defaultEvaluationMetrics]);

  // Widget conformance: fall back to first available metric option
  const optimizationMetric = evalMetrics[0]
    ? metricEntryName(evalMetrics[0])
    : (metricOptions[0] ?? "");
  const additionalMetricNames = evalMetrics.slice(1).map(metricEntryName);

  // Auto-determine direction from metric_direction mapping.
  // P-0109 PR-5: pure render-time derivation — no useEffect, no PUT.
  // The legacy "direction defensive sync useEffect" wrote this value
  // to ``config.tuning.optuna.params.direction`` on every metric
  // change and was one of the three racing writers. The backend
  // ``materialize_tuning_for_job`` (PR-4b INV-T6) now resolves the
  // canonical direction at job start, so the UI no longer needs to
  // persist the badge value — it just shows what the adapter would
  // pick.
  const autoDirection = useMemo(() => {
    if (!task || !optimizationMetric || !metricDirection) return "";
    const taskDirs = metricDirection[task];
    if (!taskDirs) return "minimize";
    return taskDirs[optimizationMetric] ?? "minimize";
  }, [task, optimizationMetric, metricDirection]);

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
