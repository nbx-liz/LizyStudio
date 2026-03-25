import { useCallback, useEffect, useMemo } from "react";
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
import { DynParam } from "./DynParam";
import { FeatureWeightsEditor } from "./FeatureWeightsEditor";
import { FormField } from "./FormField";
import { renderField } from "./field-renderers";
import { KeyValueEditor } from "./KeyValueEditor";
import { MetricsChips } from "./MetricsChips";
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
  const handleFieldChange = useCallback(
    (path: string[], value: unknown) => {
      const updated = setNestedValue(config, path, value);
      onChange(updated);
    },
    [config, onChange],
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
    ? (evalConfig.metrics as string[])
    : [];

  // Conditional evaluation params (e.g. precision_at_k → k value)
  const evalParamValues = useMemo(() => {
    const pak = evalConfig.precision_at_k;
    return { precision_at_k: typeof pak === "number" ? pak : 10 };
  }, [evalConfig]);

  // Training section — inner_valid
  const trainingConfig = (config.training as Record<string, unknown>) ?? {};
  const innerValid =
    (trainingConfig.inner_valid as Record<string, unknown>) ?? {};
  const innerValidRatio = (innerValid.ratio as number) ?? 0.2;

  // Calibration
  const calibration =
    config.calibration !== undefined
      ? (config.calibration as Record<string, unknown> | null)
      : null;

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

  // Handle changes from DynParam
  const handleHintChange = useCallback(
    (hint: import("@/api/types").ParameterHint, value: unknown) => {
      if (hint.kind === "objective") {
        handleFieldChange(["model", "params", "objective"], value);
      } else if (hint.kind === "model_metric") {
        handleFieldChange(["model", "params", "metric"], value);
      } else {
        // numeric/boolean → model.params.<key>
        const newParams = { ...modelParams, [hint.key]: value };
        const updated = setNestedValue(config, ["model", "params"], newParams);
        onChange(updated);
      }
    },
    [handleFieldChange, modelParams, config, onChange],
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
        // Check model params and config for the condition value
        const actualValue =
          modelParams[condKey] ?? getNestedValue(config, condKey.split("."));
        if (actualValue !== condValue) return false;
      }
      return true;
    },
    [uiSchema, modelParams, config],
  );

  // Auto-select defaults for objective and model_metric when empty
  useEffect(() => {
    if (!task || !uiSchema?.option_sets) return;

    // Objective: single-select, pick first option
    const objOpts = uiSchema.option_sets.objective?.[task] ?? [];
    if (objOpts.length > 0 && !modelParams.objective) {
      handleFieldChange(["model", "params", "objective"], objOpts[0]);
    }

    // Metric: multi-select, pick first option
    const metricOpts = uiSchema.option_sets.model_metric?.[task] ?? [];
    if (metricOpts.length > 0) {
      const cur = modelParams.metric;
      const empty =
        cur === undefined ||
        cur === null ||
        (Array.isArray(cur) && cur.length === 0);
      if (empty) {
        handleFieldChange(
          ["model", "params", "metric"],
          metricOpts.slice(0, 1),
        );
      }
    }
  }, [task, uiSchema, modelParams, handleFieldChange]);

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

                  {/* Model section: DynParam loop + FeatureWeights + KeyValueEditor */}
                  {sectionName === "model" && (
                    <div className="lzs-form">
                      {/* Render all parameter_hints via DynParam */}
                      {uiSchema?.parameter_hints?.map((hint) => (
                        <DynParam
                          key={hint.key}
                          hint={hint}
                          value={getValueForHint(hint)}
                          onChange={(v) => handleHintChange(hint, v)}
                          options={getOptionsForHint(hint)}
                          visible={shouldShowField(hint.key)}
                        />
                      ))}

                      <FeatureWeightsEditor
                        weights={
                          (modelConfig.feature_weights as Record<
                            string,
                            number
                          >) ?? null
                        }
                        columns={columns}
                        onChange={(weights) => {
                          const updated = setNestedValue(
                            config,
                            ["model", "feature_weights"],
                            weights,
                          );
                          onChange(updated);
                        }}
                      />

                      <KeyValueEditor
                        params={modelParams}
                        additionalParams={uiSchema?.additional_params}
                        stepMap={uiSchema?.step_map}
                        onChange={(newParams) => {
                          const updated = setNestedValue(
                            config,
                            ["model", "params"],
                            newParams,
                          );
                          onChange(updated);
                        }}
                        modelName={modelName}
                      />
                    </div>
                  )}

                  {/* Training section: inner validation */}
                  {sectionName === "training" &&
                    uiSchema?.inner_valid_options &&
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
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {uiSchema.inner_valid_options.map((opt: string) => (
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
                            const updated = setNestedValue(
                              config,
                              ["training", "inner_valid", "ratio"],
                              v ?? 0.2,
                            );
                            onChange(updated);
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
                  task={task}
                  selectedMetrics={selectedMetrics}
                  metricsByTask={uiSchema?.option_sets?.metric}
                  onChange={(metrics) => {
                    const updated = setNestedValue(
                      config,
                      ["evaluation", "metrics"],
                      metrics,
                    );
                    onChange(updated);
                  }}
                  conditionalParams={{
                    precision_at_k: {
                      label: "k",
                      min: 1,
                      max: 100,
                      default: 10,
                    },
                  }}
                  paramValues={evalParamValues}
                  onParamChange={(metric, value) => {
                    const updated = setNestedValue(
                      config,
                      ["evaluation", metric],
                      value,
                    );
                    onChange(updated);
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
            calibrationMethods={uiSchema?.calibration_methods}
            onChange={(cal) => {
              const updated = { ...config, calibration: cal };
              onChange(updated);
            }}
          />
        )}
      </Accordion>
    </div>
  );
}
