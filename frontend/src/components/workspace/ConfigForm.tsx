import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CalibrationSection } from "./CalibrationSection";
import {
  type Defs,
  getNestedValue,
  resolveProperties,
  resolveSchema,
  type SchemaProperty,
  setNestedValue,
} from "./config-utils";
import { filterInnerValidOptions } from "./cv-state";
import { FeatureWeightsEditor } from "./FeatureWeightsEditor";
import { FormField } from "./FormField";
import { renderField } from "./field-renderers";
import { KeyValueEditor } from "./KeyValueEditor";
import { MetricsChips } from "./MetricsChips";
import { ModelParamsSection } from "./ModelParamsSection";
import { NumberInput } from "./NumberInput";

interface ConfigFormProps {
  schema: Record<string, unknown>;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  hiddenFields?: string[];
  task?: string | null;
  uiSchema?: import("@/api/types").UiSchema;
  columns?: string[];
}

// --- Main component ---

const HIDDEN = ["config_version", "tuning"];
const DATA_PANEL_FIELDS = ["data", "features", "split", "task", "output_dir"];
// validation_ratio is replaced by training.inner_valid.ratio rendered manually below
const TRAINING_HIDDEN_FIELDS = ["validation_ratio", "inner_valid"];

export function ConfigForm({
  schema,
  config,
  onChange,
  hiddenFields = HIDDEN,
  task,
  uiSchema,
  columns = [],
}: ConfigFormProps) {
  // HIGH-5: keep a ref to the latest config so field-change updates
  // always apply on top of the freshest snapshot. Previously the
  // inner_valid reset effect and the objective/metric auto-select
  // effect could both capture the same ``config`` closure in a single
  // render. When both fired the second call would rebuild the config
  // from the stale snapshot and wipe the first effect's write.
  const configRef = useRef(config);
  configRef.current = config;

  const handleFieldChange = useCallback(
    (path: string[], value: unknown) => {
      const updated = setNestedValue(configRef.current, path, value);
      configRef.current = updated;
      onChange(updated);
    },
    [onChange],
  );

  const defs = useMemo(
    () => ((schema as { $defs?: Defs }).$defs ?? {}) as Defs,
    [schema],
  );
  const rawProperties = (
    schema as { properties?: Record<string, SchemaProperty> }
  ).properties;

  const properties = useMemo(
    () => (rawProperties ? resolveProperties(rawProperties, defs, config) : {}),
    [rawProperties, defs, config],
  );

  // Model section data
  const modelConfig = (config.model as Record<string, unknown>) ?? {};
  const modelName = (modelConfig.name as string) ?? "lgbm";
  const modelParams = (modelConfig.params as Record<string, unknown>) ?? {};
  // Evaluation metrics
  const evalConfig = (config.evaluation as Record<string, unknown>) ?? {};
  const selectedMetrics = Array.isArray(evalConfig.metrics)
    ? (evalConfig.metrics as import("@/api/types").MetricEntry[])
    : [];

  // Training section — inner_valid
  const trainingConfig = (config.training as Record<string, unknown>) ?? {};
  const innerValid =
    (trainingConfig.inner_valid as Record<string, unknown>) ?? {};
  const innerValidRatio = (innerValid.ratio as number) ?? 0.2;

  // Filter inner_valid options by CV strategy
  const splitConfig = (config.split as Record<string, unknown>) ?? {};
  const cvStrategy = (splitConfig.method as string) ?? "kfold";
  const filteredInnerValidOptions = useMemo(
    () =>
      filterInnerValidOptions(
        (uiSchema?.inner_valid_options as string[]) ?? [],
        cvStrategy,
      ),
    [uiSchema?.inner_valid_options, cvStrategy],
  );

  // Auto-reset inner_valid when current selection is not in filtered options
  const currentInnerValid = (innerValid.method as string) ?? "holdout";
  useEffect(() => {
    // Same guard as the objective/metric effect below: avoid partial-PUT
    // races while the config is still being seeded by useDataPanel.
    if (!config.config_version) return;
    if (
      filteredInnerValidOptions.length > 0 &&
      !filteredInnerValidOptions.includes(currentInnerValid)
    ) {
      handleFieldChange(["training", "inner_valid", "method"], "holdout");
    }
  }, [
    filteredInnerValidOptions,
    currentInnerValid,
    handleFieldChange,
    config.config_version,
  ]);

  // Calibration
  const calibration =
    config.calibration !== undefined
      ? (config.calibration as Record<string, unknown> | null)
      : null;

  // Issue #269: lizyml only supports calibration for task="binary".
  // The Calibration UI hides itself for other tasks via
  // ``conditional_visibility``, but until now the underlying value was
  // left alone — a user enabling calibration on binary then switching
  // to regression sneaked a stale calibration object into POST /fit
  // and the job died ~5s later with CALIBRATION_NOT_SUPPORTED.
  // Same shape as the inner_valid auto-reset above.
  //
  // Issue #272: bail while the snapshot is stale. When the user clicks
  // a different task radio, ``task`` (prop) updates synchronously but
  // ``config.task`` (cached server state) lags behind useConfigSync's
  // PUT. Writing here would PUT a body where ``task`` is still the
  // previous value, reverting the user's intent. Wait for the next
  // render after useConfigSync flushes and configRef.current catches up.
  useEffect(() => {
    if (!config.config_version) return;
    if (task && config.task && task !== config.task) return;
    if (task && task !== "binary" && calibration !== null) {
      handleFieldChange(["calibration"], null);
    }
  }, [
    task,
    calibration,
    handleFieldChange,
    config.config_version,
    config.task,
  ]);

  // Resolve options for objective/model_metric kinds from option_sets
  const getOptionsForHint = useCallback(
    (hint: import("@/api/types").ParameterHint): string[] => {
      if (!task) return [];
      if (hint.kind === "objective") {
        return uiSchema?.option_sets?.objective?.[task] ?? [];
      }
      if (hint.kind === "model_metric") {
        return uiSchema?.option_sets?.model_metric?.[task] ?? [];
      }
      return [];
    },
    [task, uiSchema],
  );

  // Resolve the current value for a parameter hint
  const getValueForHint = useCallback(
    (hint: import("@/api/types").ParameterHint): unknown => {
      // objective and metric live at model.params.objective and model.metric respectively
      if (hint.kind === "objective") {
        return modelParams.objective;
      }
      if (hint.kind === "model_metric") {
        return modelParams.metric;
      }
      // numeric/boolean params live under model.params
      return modelParams[hint.key];
    },
    [modelParams],
  );

  // Handle changes from DynParam. All branches route through
  // handleFieldChange so writes merge onto the latest configRef.current
  // snapshot (Issue #253). Using the per-key path keeps every branch
  // symmetric and lets setNestedValue do the shallow-copy merge.
  const handleHintChange = useCallback(
    (hint: import("@/api/types").ParameterHint, value: unknown) => {
      if (hint.kind === "objective") {
        handleFieldChange(["model", "params", "objective"], value);
      } else if (hint.kind === "model_metric") {
        handleFieldChange(["model", "params", "metric"], value);
      } else {
        handleFieldChange(["model", "params", hint.key], value);
      }
    },
    [handleFieldChange],
  );

  // Check which fields should be hidden by conditional_visibility
  const shouldShowField = useCallback(
    (key: string) => {
      const vis = uiSchema?.conditional_visibility?.[key];
      if (!vis) return true;
      // Evaluate each condition in the visibility map
      for (const [condKey, condValue] of Object.entries(
        vis as Record<string, unknown>,
      )) {
        // Check model-level fields, model.params, then full config path
        const actualValue =
          modelConfig[condKey] ??
          modelParams[condKey] ??
          getNestedValue(config, condKey.split("."));
        if (actualValue !== condValue) return false;
      }
      return true;
    },
    [uiSchema, modelConfig, modelParams, config],
  );

  // Auto-select defaults for objective and model_metric when empty OR
  // when the current value belongs to a different task (H-0062 Bugfix
  // 2026-04-14 (3)). The original guard only fired for empty values,
  // so switching task=multiclass -> task=binary left
  // objective=multiclass / metric=[auc_mu, multi_logloss] stale and
  // the subsequent Tune failed with "All tuning trials failed" because
  // LGBM rejects a multiclass objective on a binary target.
  useEffect(() => {
    if (!task || !uiSchema?.option_sets) return;
    // Issue #107 regression guard: skip auto-select while the config is
    // still empty or only partially seeded. Writing to an empty config
    // here produces a partial-only PUT like {model:{params:{objective}}}
    // that overwrites the server-side config via the router's assignment
    // semantics, re-surfacing 'config_version / task / split: Field
    // required' validation errors. Wait until useDataPanel has seeded a
    // full config (recognised by config_version being set).
    if (!config.config_version) return;
    // Issue #272: bail while config.task is stale. When the user clicks
    // a different task radio, the prop updates synchronously but the
    // cached config still reflects the previous task until useConfigSync
    // flushes its PUT. Writing here would derive the body from the
    // pre-flush snapshot (model.params.objective gets reset against the
    // stale task field), then PUT it — reverting the user's task pick.
    // Wait for the next render where configRef catches up.
    if (config.task && task !== config.task) return;

    // Objective: single-select. Reset when empty OR when current value
    // is not in the list of objectives valid for the current task.
    const objOpts = uiSchema.option_sets.objective?.[task] ?? [];
    if (objOpts.length > 0) {
      const currentObj = modelParams.objective;
      const objInvalid =
        typeof currentObj === "string" && !objOpts.includes(currentObj);
      if (!currentObj || objInvalid) {
        handleFieldChange(["model", "params", "objective"], objOpts[0]);
      }
    }

    // Metric: multi-select, use parameter_hints default for task.
    // Reset when empty OR when no current entry is valid for the task.
    const metricOpts = uiSchema.option_sets.model_metric?.[task] ?? [];
    if (metricOpts.length > 0) {
      const cur = modelParams.metric;
      const empty =
        cur === undefined ||
        cur === null ||
        (Array.isArray(cur) && cur.length === 0);
      const allInvalid =
        Array.isArray(cur) &&
        cur.length > 0 &&
        cur.every(
          (m: unknown) => typeof m !== "string" || !metricOpts.includes(m),
        );
      if (empty || allInvalid) {
        const metricHint = uiSchema.parameter_hints?.find(
          (h: { key: string }) => h.key === "metric",
        );
        const hintDefault = (
          metricHint?.default as Record<string, unknown> | undefined
        )?.[task];
        const defaults = Array.isArray(hintDefault)
          ? (hintDefault as unknown[]).filter(
              (m): m is string =>
                typeof m === "string" && metricOpts.includes(m),
            )
          : [];
        handleFieldChange(
          ["model", "params", "metric"],
          defaults.length > 0 ? defaults : metricOpts.slice(0, 1),
        );
      }
    }
  }, [
    task,
    uiSchema,
    modelParams,
    handleFieldChange,
    config.config_version,
    config.task,
  ]);

  if (!rawProperties) return null;

  // Separate sections
  const sections: [string, SchemaProperty][] = [];
  const fields: [string, SchemaProperty][] = [];

  for (const [name, prop] of Object.entries(properties)) {
    if (hiddenFields.includes(name)) continue;
    if (DATA_PANEL_FIELDS.includes(name)) continue;
    if (name === "calibration") continue;
    // Evaluation is rendered separately with MetricsChips below
    if (name === "evaluation") continue;
    if (prop.type === "object" && prop.properties) {
      sections.push([name, prop]);
    } else {
      fields.push([name, prop]);
    }
  }

  return (
    <div className="space-y-4">
      {fields.length > 0 && (
        <div className="space-y-3">
          {fields.map(([name, prop]) =>
            renderField(
              prop,
              name,
              [name],
              getNestedValue(config, [name]),
              handleFieldChange,
              defs,
            ),
          )}
        </div>
      )}
      <Accordion
        type="multiple"
        defaultValue={["model", "training", "evaluation"]}
      >
        {sections.map(([sectionName, sectionProp]) => {
          const sectionValue =
            (config[sectionName] as Record<string, unknown>) ??
            (sectionProp.default as Record<string, unknown>) ??
            {};
          return (
            <AccordionItem
              key={sectionName}
              value={sectionName}
              className="border-b"
            >
              <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
                {uiSchema?.sections?.find(
                  (s: { key: string }) => s.key === sectionName,
                )?.title ??
                  sectionProp.title ??
                  sectionName}
              </AccordionTrigger>
              <AccordionContent>
                <div className="lzs-form space-y-1.5 pl-[18px] pt-2">
                  {/* Non-model sections: render fields from JSON schema */}
                  {sectionName !== "model" &&
                    sectionProp.properties &&
                    Object.entries(sectionProp.properties)
                      .filter(([n]) => !hiddenFields.includes(n))
                      .filter(([n]) =>
                        sectionName === "training"
                          ? !TRAINING_HIDDEN_FIELDS.includes(n)
                          : true,
                      )
                      .filter(
                        ([, p]) => resolveSchema(p, defs).const === undefined,
                      )
                      .map(([fieldName, fieldProp]) =>
                        renderField(
                          fieldProp,
                          fieldName,
                          [sectionName, fieldName],
                          sectionValue[fieldName],
                          handleFieldChange,
                          defs,
                        ),
                      )}

                  {/* Model section: 3-subgroup layout (H-0030) */}
                  {sectionName === "model" && (
                    <div className="lzs-form">
                      {/* ── Smart Params ── */}
                      <div className="border-t my-3" />
                      <p className="text-xs text-muted-foreground font-medium mb-2">
                        Smart Params
                      </p>
                      {sectionProp.properties &&
                        Object.entries(sectionProp.properties)
                          .filter(
                            ([, p]) =>
                              resolveSchema(p, defs).const === undefined,
                          )
                          .filter(([n]) => n !== "name" && n !== "params")
                          .filter(([n]) => shouldShowField(n))
                          .map(([fieldName, fieldProp]) =>
                            renderField(
                              fieldProp,
                              fieldName,
                              ["model", fieldName],
                              (sectionValue as Record<string, unknown>)[
                                fieldName
                              ],
                              handleFieldChange,
                              defs,
                            ),
                          )}
                      <FeatureWeightsEditor
                        weights={
                          (modelConfig.feature_weights as Record<
                            string,
                            number
                          >) ?? null
                        }
                        columns={columns}
                        onChange={(weights) => {
                          handleFieldChange(
                            ["model", "feature_weights"],
                            weights,
                          );
                        }}
                      />

                      {/* ── Model Params ── */}
                      <div className="border-t my-3" />
                      <p className="text-xs text-muted-foreground font-medium mb-2">
                        Model Params
                      </p>
                      <ModelParamsSection
                        hints={uiSchema?.parameter_hints ?? []}
                        getValueForHint={getValueForHint}
                        handleHintChange={handleHintChange}
                        getOptionsForHint={getOptionsForHint}
                        shouldShowField={shouldShowField}
                        precisionAtKValue={
                          (modelParams._precision_at_k_k as number) ?? 10
                        }
                        onPrecisionAtKChange={(k) =>
                          handleFieldChange(
                            ["model", "params", "_precision_at_k_k"],
                            k,
                          )
                        }
                      />

                      {/* ── Additional Params ── */}
                      <div className="border-t my-3" />
                      <p className="text-xs text-muted-foreground font-medium mb-2">
                        Additional Params
                      </p>
                      <KeyValueEditor
                        params={modelParams}
                        additionalParams={
                          uiSchema?.additional_params ?? undefined
                        }
                        stepMap={uiSchema?.step_map}
                        onChange={(newParams) => {
                          handleFieldChange(["model", "params"], newParams);
                        }}
                        modelName={modelName}
                      />
                    </div>
                  )}

                  {/* Training section: inner validation */}
                  {sectionName === "training" &&
                    filteredInnerValidOptions.length > 0 &&
                    (trainingConfig.early_stopping as Record<string, unknown>)
                      ?.enabled === true && (
                      <FormField
                        label="Inner Validation"
                        description="Inner validation strategy for early stopping"
                      >
                        <Select
                          value={String(
                            (
                              trainingConfig.inner_valid as Record<
                                string,
                                unknown
                              >
                            )?.method ?? "holdout",
                          )}
                          onValueChange={(v) =>
                            handleFieldChange(
                              ["training", "inner_valid", "method"],
                              v,
                            )
                          }
                        >
                          <SelectTrigger
                            aria-label="Inner validation method"
                            className="h-8 text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredInnerValidOptions.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                    )}
                  {sectionName === "training" &&
                    (trainingConfig.early_stopping as Record<string, unknown>)
                      ?.enabled === true && (
                      <FormField
                        label="Inner Valid Ratio"
                        description="Ratio for inner validation holdout"
                      >
                        <NumberInput
                          value={innerValidRatio}
                          onChange={(v) => {
                            handleFieldChange(
                              ["training", "inner_valid", "ratio"],
                              v ?? 0.2,
                            );
                          }}
                          step={0.05}
                          min={0.01}
                          max={0.5}
                        />
                      </FormField>
                    )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}

        {/* Evaluation section with MetricsChips */}
        {task && (
          <AccordionItem value="evaluation" className="border-b">
            <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
              Evaluation
            </AccordionTrigger>
            <AccordionContent>
              <div className="lzs-form pl-[18px] pt-2">
                <MetricsChips
                  // Issue #272: pass the persisted ``config.task`` (not
                  // the raw prop) so MetricsChips' task-change auto-reset
                  // only fires once the regression PUT has actually
                  // landed. Otherwise it auto-defaults metrics from the
                  // PROP task while configRef still reads the old task,
                  // PUTs a body where ``task`` and ``metrics`` disagree,
                  // and the backend rejects the entire body with
                  // saved=false (silently reverting the task switch).
                  task={(config.task as string) || task}
                  selectedMetrics={selectedMetrics}
                  metricsByTask={uiSchema?.option_sets?.metric}
                  onChange={(metrics) => {
                    handleFieldChange(["evaluation", "metrics"], metrics);
                  }}
                  conditionalParams={{
                    precision_at_k: {
                      label: "k",
                      min: 1,
                      max: 100,
                      default: 10,
                    },
                  }}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Calibration section with ON/OFF toggle */}
        {(() => {
          const calVis = uiSchema?.conditional_visibility?.calibration;
          const showCal = calVis
            ? Array.isArray(calVis.task) &&
              task != null &&
              (calVis.task as string[]).includes(task)
            : task === "binary";
          return showCal;
        })() && (
          <CalibrationSection
            calibration={calibration}
            calibrationDefaults={uiSchema?.defaults?.calibration}
            calibrationMethods={uiSchema?.calibration_methods ?? undefined}
            onChange={(cal) => {
              handleFieldChange(["calibration"], cal);
            }}
          />
        )}
      </Accordion>
    </div>
  );
}
