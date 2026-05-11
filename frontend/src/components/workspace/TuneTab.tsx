import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MetricEntry } from "@/api/types";
import { RetuneSettingsSection } from "@/components/retune";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { filterInnerValidOptions, recommendedInnerValid } from "./cv-state";
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

  // Auto-populate search space with catalog entries that have default_mode: "range".
  const spaceInitialized = useRef(false);
  const prevTuningRef = useRef(config.tuning);
  useEffect(() => {
    if (prevTuningRef.current && !config.tuning) {
      spaceInitialized.current = false;
    }
    prevTuningRef.current = config.tuning;
  }, [config.tuning]);
  useEffect(() => {
    if (spaceInitialized.current) return;
    if (Object.keys(searchSpace).length > 0) {
      spaceInitialized.current = true;
      return;
    }
    const catalogEntries = uiSchema?.search_space_catalog;
    if (!catalogEntries) return;
    const defaultSpace: Record<string, unknown> = {};
    for (const entry of catalogEntries) {
      if (entry.default_mode === "range" && entry.default_range) {
        defaultSpace[entry.key] = {
          type: entry.paramType === "integer" ? "int" : "float",
          low: entry.default_range.low,
          high: entry.default_range.high,
          log: entry.default_range.log,
          category: groupToCategory(entry.group ?? "model_params"),
        };
      } else if (entry.default_mode === "choice" && entry.default_choices) {
        defaultSpace[entry.key] = {
          type: "categorical",
          choices: entry.default_choices.map(String),
          category: groupToCategory(entry.group ?? "model_params"),
        };
      }
    }
    if (Object.keys(defaultSpace).length > 0) {
      spaceInitialized.current = true;
      onChange(updateOptunaField(config, "space", defaultSpace));
    }
  }, [searchSpace, config, onChange, uiSchema]);

  // Evaluation from tuning.evaluation (Widget conformance — NOT tuning.optuna.evaluation)
  const evaluation = extractTuningField<{
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
    return uiSchema?.metric_direction ?? undefined;
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

  // Per-parameter option sets — exclude "metric" to avoid overriding
  // SearchSpaceTable's getChoiceOptions which correctly uses model_metric.
  const paramOptionSets = useMemo((): Record<string, string[]> => {
    if (!uiSchema?.option_sets) return {};
    const result: Record<string, string[]> = {};
    for (const [paramKey, value] of Object.entries(uiSchema.option_sets)) {
      // Skip "metric" — SearchSpaceTable handles it via metricOptions prop
      if (paramKey === "metric") continue;
      if (Array.isArray(value)) {
        result[paramKey] = value as string[];
      } else if (task && typeof value === "object" && value !== null) {
        const taskMap = value as Record<string, string[]>;
        if (taskMap[task]) {
          result[paramKey] = taskMap[task];
        }
      }
    }
    return result;
  }, [task, uiSchema]);

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
              space={searchSpace}
              modelParams={modelParams}
              onChange={handleSpaceChange}
              catalog={uiSchema?.search_space_catalog}
              stepMap={uiSchema?.step_map}
              task={task}
              objectiveOptions={objectiveOptions}
              metricOptions={modelMetricOptions}
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
            metricOptions={metricOptions}
            metricDirection={metricDirection}
            evaluation={evaluation}
            tuningParams={tuningParams}
          />
        </AccordionContent>
      </AccordionItem>
      <RetuneSettingsSection config={config} onChange={onChange} />
    </Accordion>
  );
}
