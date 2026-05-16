import { useCallback, useEffect, useMemo } from "react";
import { useTuningSnapshot } from "@/api/queries/useWorkspace";
import type { MetricEntry } from "@/api/types";
import { RetuneSettingsSection } from "@/components/retune";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { filterInnerValidOptions, recommendedInnerValid } from "./cv-state";
import {
  evalMetricOptionsFor,
  metricChoicesFor,
  metricOptionsFor,
  objectiveOptionsFor,
} from "./metric-options";
import { groupToCategory, SearchSpaceTable } from "./SearchSpaceTable";
import { TuneEvaluationSection } from "./TuneEvaluationSection";
import { TuneSettings } from "./TuneSettings";
import {
  extractOptunaField,
  extractTuningField,
  updateOptunaField,
} from "./tune-config-utils";

interface TuneTabProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  task: string | null;
  uiSchema?: import("@/api/types").UiSchema;
  columns?: string[];
}

export function TuneTab({
  config,
  onChange,
  task,
  uiSchema,
  columns,
}: TuneTabProps) {
  const tuningParams = extractOptunaField<{
    n_trials?: number;
    timeout?: number | null;
  }>(config, "params", {});

  const searchSpace = extractOptunaField<Record<string, unknown>>(
    config,
    "space",
    {},
  );

  // P-0109 PR-5: catalog-default search space, computed locally per render.
  //
  // Replaces the legacy "search-space init useEffect" that auto-wrote
  // catalog defaults to ``config.tuning.optuna.space`` on first mount.
  // That useEffect raced against TuneEvaluationSection's
  // direction-sync and metrics-seed useEffects through the WriteFunnel
  // — all three shared the ``config-form-edit`` reason and the funnel
  // coalesced them to the last-arriver, leaving the search-space write
  // dropped and every row rendering in Fixed mode.
  //
  // The fix: derive the rendering-only catalog defaults from
  // ``uiSchema.search_space_catalog`` at render time and merge with
  // the user's persisted overrides. No backend write fires unless the
  // user explicitly edits a row, so there is no race to lose.
  const catalogDefaultSpace = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const entry of uiSchema?.search_space_catalog ?? []) {
      if (entry.default_mode === "range" && entry.default_range) {
        out[entry.key] = {
          type: entry.paramType === "integer" ? "int" : "float",
          low: entry.default_range.low,
          high: entry.default_range.high,
          log: entry.default_range.log,
          category: groupToCategory(entry.group ?? "model_params"),
        };
      } else if (entry.default_mode === "choice" && entry.default_choices) {
        out[entry.key] = {
          type: "categorical",
          choices: entry.default_choices.map(String),
          category: groupToCategory(entry.group ?? "model_params"),
        };
      }
    }
    return out;
  }, [uiSchema]);

  const effectiveSpace = useMemo(
    () => ({ ...catalogDefaultSpace, ...searchSpace }),
    [catalogDefaultSpace, searchSpace],
  );

  // Evaluation from tuning.evaluation (Widget conformance — NOT tuning.optuna.evaluation)
  const evaluation = extractTuningField<{
    metrics?: MetricEntry[];
  }>(config, "evaluation", {});

  const modelSection = (config.model as Record<string, unknown>) ?? {};
  const modelParams = (modelSection.params as Record<string, unknown>) ?? {};

  // Eval-metrics registry list for the current task — used by the Tune
  // Evaluation section (Optimization Metric / Additional Metrics). These
  // are LizyML post-hoc reporting metrics, NOT the LightGBM ``metric`` param.
  const evalMetricOptions = useMemo(
    () => evalMetricOptionsFor(uiSchema, task),
    [task, uiSchema],
  );

  // metric_direction map for auto direction
  const metricDirection = useMemo(() => {
    return uiSchema?.metric_direction ?? undefined;
  }, [uiSchema]);

  // Objective options for task
  const objectiveOptions = useMemo(
    () => objectiveOptionsFor(uiSchema, task),
    [task, uiSchema],
  );

  // Model-metric options (``model.params.metric``) — flat native ∪ feval
  // list for the Search Space catalog ``metric`` row, plus the feval
  // subset for the "Custom (slow)" badge (P-0104 Wave 3.1b / Q2/Q3).
  const modelMetricOptions = useMemo(
    () => metricOptionsFor(uiSchema, task),
    [task, uiSchema],
  );
  const fevalMetrics = useMemo(
    () => metricChoicesFor(uiSchema, task).feval,
    [task, uiSchema],
  );

  // P-0104 Wave 3.1a / Issue #461: hyper-parameter bounds for the current
  // task, forwarded to SearchSpaceTable so Range Min/Max NumberInputs clamp.
  const parameterBounds = useMemo(() => {
    if (!task) return undefined;
    return uiSchema?.parameter_bounds?.[task] ?? undefined;
  }, [task, uiSchema]);

  // Per-parameter option sets keyed by Search Space catalog param name.
  // Only ``objective`` has a catalog row with choices; ``metric`` is
  // handled by SearchSpaceTable via the ``metricOptions`` prop, and
  // ``eval_metric`` is not a catalog param.
  const paramOptionSets = useMemo((): Record<string, string[]> => {
    const result: Record<string, string[]> = {};
    if (objectiveOptions.length > 0) result.objective = objectiveOptions;
    return result;
  }, [objectiveOptions]);

  // P-0109 PR-6c: subscribe to the Tune-tab intent/effective/defaults
  // triple. Used as:
  //   * ``tuning_defaults.evaluation_metrics`` — canonical eval-metric
  //     fallback for ``TuneEvaluationSection`` (replaces the frontend
  //     ``TASK_DEFAULT_METRICS`` constant that PR-5 left in place).
  //   * ``tuning_effective.user_set_paths`` — per-row "modified" badge
  //     provenance for ``SearchSpaceRow``. Entries the user explicitly
  //     touched render with the badge; catalog-default rows do not.
  // The query is enabled only when a task is set: a fresh workspace
  // (no task) returns empty defaults and an empty effective, and
  // running this before the user picks a task would pollute the cache
  // with a transient empty result.
  const { data: tuningSnapshot } = useTuningSnapshot({ enabled: !!task });
  const defaultEvaluationMetrics = useMemo<unknown[]>(() => {
    const fromSnapshot = tuningSnapshot?.tuning_defaults.evaluation_metrics;
    return Array.isArray(fromSnapshot) ? fromSnapshot : [];
  }, [tuningSnapshot]);
  const userSetSpaceKeys = useMemo<Set<string>>(() => {
    const paths = tuningSnapshot?.tuning_effective.user_set_paths ?? [];
    const out = new Set<string>();
    for (const p of paths) {
      if (p.startsWith("space.")) out.add(p.slice("space.".length));
    }
    return out;
  }, [tuningSnapshot]);

  const handleParamsChange = (params: Record<string, unknown>) => {
    onChange(updateOptunaField(config, "params", params));
  };

  const handleSpaceChange = (space: Record<string, unknown>) => {
    onChange(updateOptunaField(config, "space", space));
  };

  const handleModelParamChange = useCallback(
    (key: string, value: unknown) => {
      const newParams = { ...modelParams, [key]: value };
      const model = (config.model as Record<string, unknown>) ?? {};
      onChange({ ...config, model: { ...model, params: newParams } });
    },
    [config, modelParams, onChange],
  );

  // P-0104 Wave 2.3 / Issue #459 — inner_valid auto-reset on CV strategy
  // change.
  //
  // When the outer CV strategy switches between time / group / standard
  // families, the persisted ``model.params.inner_valid`` may no longer be
  // a member of the strategy's allowed set (e.g. ``time_holdout`` is only
  // valid under ``time_series_*`` strategies). This effect reconciles the
  // persisted value to the strategy-recommended default so the UI and the
  // wire payload converge before the user runs a tune.
  const cvStrategy = useMemo(() => {
    const split = (config.split as Record<string, unknown>) ?? {};
    return typeof split.method === "string" ? split.method : "";
  }, [config.split]);

  const innerValidOptions = useMemo(
    () => uiSchema?.inner_valid_options ?? [],
    [uiSchema],
  );

  useEffect(() => {
    if (!cvStrategy || innerValidOptions.length === 0) return;
    const filtered = filterInnerValidOptions(innerValidOptions, cvStrategy);
    const current = modelParams.inner_valid;
    if (typeof current === "string" && filtered.includes(current)) return;
    const recommended = recommendedInnerValid(cvStrategy);
    if (current === recommended) return;
    handleModelParamChange("inner_valid", recommended);
  }, [cvStrategy, innerValidOptions, modelParams, handleModelParamChange]);

  return (
    <Accordion
      type="multiple"
      defaultValue={["settings", "search-space", "evaluation", "retune"]}
    >
      <TuneSettings
        tuningParams={tuningParams}
        onChange={handleParamsChange}
        nTrialsPresets={uiSchema?.n_trials_presets ?? undefined}
      />
      <AccordionItem value="search-space" className="border-b">
        <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
          Search Space
        </AccordionTrigger>
        <AccordionContent>
          <div className="pl-[18px]">
            <SearchSpaceTable
              space={effectiveSpace}
              modelParams={modelParams}
              onChange={handleSpaceChange}
              catalog={uiSchema?.search_space_catalog}
              stepMap={uiSchema?.step_map}
              task={task}
              objectiveOptions={objectiveOptions}
              metricOptions={modelMetricOptions}
              fevalMetrics={fevalMetrics}
              additionalParams={uiSchema?.additional_params ?? undefined}
              paramOptionSets={paramOptionSets}
              onModelParamChange={handleModelParamChange}
              conditionalVisibility={uiSchema?.conditional_visibility}
              specialSearchSpaceFields={
                uiSchema?.special_search_space_fields ?? undefined
              }
              columns={columns}
              cvStrategy={cvStrategy}
              innerValidOptions={innerValidOptions}
              parameterBounds={parameterBounds}
              userSetSpaceKeys={userSetSpaceKeys}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="evaluation" className="border-b">
        <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
          Evaluation
        </AccordionTrigger>
        <AccordionContent>
          <TuneEvaluationSection
            config={config}
            onChange={onChange}
            task={task}
            metricOptions={evalMetricOptions}
            metricDirection={metricDirection}
            evaluation={evaluation}
            tuningParams={tuningParams}
            defaultEvaluationMetrics={defaultEvaluationMetrics}
          />
        </AccordionContent>
      </AccordionItem>
      <RetuneSettingsSection config={config} onChange={onChange} />
    </Accordion>
  );
}
