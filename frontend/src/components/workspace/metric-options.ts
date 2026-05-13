import type { UiSchema } from "@/api/types";

/**
 * Accessors for the heterogeneous ``uiSchema.option_sets`` map (P-0104
 * Wave 3.1b). The generated type is
 * ``{ [key: string]: { [task: string]: string[] | { [section: string]: string[] } } }``
 * because ``objective`` / ``eval_metric`` are ``{task: [...]}`` while
 * ``metric`` is the nested ``{task: {native, feval}}`` shape sourced from
 * LizyML's ``LGBMProvider.metric_choices(task)``. These helpers centralise
 * the narrowing so call sites stay readable.
 */

type OptionSetEntry = string[] | { [section: string]: string[] };

function asStringList(value: OptionSetEntry | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function asSections(value: OptionSetEntry | undefined): {
  native: string[];
  feval: string[];
} {
  if (value && !Array.isArray(value)) {
    return {
      native: Array.isArray(value.native) ? value.native : [],
      feval: Array.isArray(value.feval) ? value.feval : [],
    };
  }
  return { native: [], feval: [] };
}

/** Objective choices for the given task (``model.params.objective``). */
export function objectiveOptionsFor(
  uiSchema: UiSchema | undefined,
  task: string | null | undefined,
): string[] {
  if (!task) return [];
  return asStringList(uiSchema?.option_sets?.objective?.[task]);
}

export interface MetricChoices {
  /** LightGBM built-in ``metric`` names — cheap, evaluated by the booster. */
  native: string[];
  /** LizyML custom feval implementations — slower (re-evaluated in Python). */
  feval: string[];
}

/** Model-metric choices (``model.params.metric``) split into native / feval. */
export function metricChoicesFor(
  uiSchema: UiSchema | undefined,
  task: string | null | undefined,
): MetricChoices {
  if (!task) return { native: [], feval: [] };
  return asSections(uiSchema?.option_sets?.metric?.[task]);
}

/** Flat model-metric option list (``native`` followed by ``feval``). */
export function metricOptionsFor(
  uiSchema: UiSchema | undefined,
  task: string | null | undefined,
): string[] {
  const { native, feval } = metricChoicesFor(uiSchema, task);
  return [...native, ...feval];
}

/** Eval-metrics registry list — post-hoc reporting metrics, NOT the
 *  LightGBM ``metric`` param. Used by the Tune Evaluation section. */
export function evalMetricOptionsFor(
  uiSchema: UiSchema | undefined,
  task: string | null | undefined,
): string[] {
  if (!task) return [];
  return asStringList(uiSchema?.option_sets?.eval_metric?.[task]);
}

/** True when ``metric`` is a LizyML custom feval metric (badged "Custom (slow)"). */
export function isCustomFevalMetric(
  uiSchema: UiSchema | undefined,
  task: string | null | undefined,
  metric: string,
): boolean {
  return metricChoicesFor(uiSchema, task).feval.includes(metric);
}

/** Eval-metrics registry as a ``{task: [metric, ...]}`` map (for MetricsChips). */
export function evalMetricMap(
  uiSchema: UiSchema | undefined,
): Record<string, string[]> {
  const raw = uiSchema?.option_sets?.eval_metric ?? {};
  const out: Record<string, string[]> = {};
  for (const [task, value] of Object.entries(raw)) {
    if (Array.isArray(value)) out[task] = value;
  }
  return out;
}
