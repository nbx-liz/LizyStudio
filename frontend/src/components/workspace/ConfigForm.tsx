import { useCallback, useMemo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import { Switch } from "@/components/ui/switch";
import { CalibrationSection } from "./CalibrationSection";
import {
  type Defs,
  getNestedValue,
  resolveProperties,
  resolveSchema,
  type SchemaProperty,
  setNestedValue,
} from "./config-utils";
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
const DATA_PANEL_FIELDS = ["data", "features", "split"];
// validation_ratio is replaced by training.inner_valid.ratio rendered manually below
const TRAINING_HIDDEN_FIELDS = ["validation_ratio"];

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
  const modelMetric = (modelConfig.metric as string) ?? "";

  // auto_num_leaves conditional visibility
  const autoNumLeaves = modelParams.auto_num_leaves === true;

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

  // Model metric options from ui_schema
  const modelMetricOptions = useMemo(() => {
    if (!task) return [];
    const opts = uiSchema?.option_sets?.model_metric;
    if (opts?.[task]) return opts[task];
    return [];
  }, [task, uiSchema]);

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

  if (!rawProperties) return null;

  // Separate sections
  const sections: [string, SchemaProperty][] = [];
  const fields: [string, SchemaProperty][] = [];

  for (const [name, prop] of Object.entries(properties)) {
    if (hiddenFields.includes(name)) continue;
    if (DATA_PANEL_FIELDS.includes(name)) continue;
    if (name === "calibration") continue;
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
              <AccordionTrigger className="text-sm font-medium hover:bg-muted/50">
                {sectionProp.title ?? sectionName}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pt-2">
                  {sectionProp.properties &&
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

                  {/* Model section: 3 sub-groups */}
                  {sectionName === "model" && (
                    <>
                      {/* Sub-group 1: Smart Params */}
                      <p className="text-sm text-muted-foreground font-medium mb-2">
                        Smart Params
                      </p>
                      <FormField
                        label="Auto Num Leaves"
                        description="Automatically calculate num_leaves from data"
                      >
                        <Switch
                          checked={autoNumLeaves}
                          onCheckedChange={(checked) => {
                            const newParams = {
                              ...modelParams,
                              auto_num_leaves: checked,
                            };
                            const updated = setNestedValue(
                              config,
                              ["model", "params"],
                              newParams,
                            );
                            onChange(updated);
                          }}
                        />
                      </FormField>

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

                      {/* Balanced */}
                      <FormField
                        label="Balanced"
                        description="Class weight balancing"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const current = modelConfig.balanced;
                              handleFieldChange(
                                ["model", "balanced"],
                                current == null ? true : null,
                              );
                            }}
                          >
                            <Badge
                              variant={
                                modelConfig.balanced == null
                                  ? "default"
                                  : "outline"
                              }
                              className="cursor-pointer text-xs"
                            >
                              {modelConfig.balanced == null
                                ? "Auto \u2713"
                                : "Auto"}
                            </Badge>
                          </button>
                          <Switch
                            checked={modelConfig.balanced === true}
                            disabled={modelConfig.balanced == null}
                            onCheckedChange={(v) =>
                              handleFieldChange(["model", "balanced"], v)
                            }
                          />
                        </div>
                      </FormField>

                      {/* Sub-group 2: Model Params */}
                      <Separator className="my-3" />
                      <p className="text-sm text-muted-foreground font-medium mb-2">
                        Model Params
                      </p>

                      {/* Objective segment buttons */}
                      {task && uiSchema?.option_sets?.objective?.[task] && (
                        <FormField
                          label="Objective"
                          description="LightGBM objective function"
                        >
                          <div className="flex flex-wrap gap-1">
                            {uiSchema.option_sets.objective[task].map(
                              (obj: string) => (
                                <button
                                  key={obj}
                                  type="button"
                                  onClick={() => {
                                    handleFieldChange(
                                      ["model", "params", "objective"],
                                      obj,
                                    );
                                  }}
                                >
                                  <Badge
                                    variant={
                                      modelParams.objective === obj
                                        ? "default"
                                        : "outline"
                                    }
                                    className="cursor-pointer text-xs"
                                  >
                                    {obj}
                                  </Badge>
                                </button>
                              ),
                            )}
                          </div>
                        </FormField>
                      )}

                      {/* Model metric chips */}
                      {task && modelMetricOptions.length > 0 && (
                        <div>
                          <FormField
                            label="Metric"
                            description="LightGBM training metric"
                          >
                            <span />
                          </FormField>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {modelMetricOptions.map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  const updated = setNestedValue(
                                    config,
                                    ["model", "metric"],
                                    m,
                                  );
                                  onChange(updated);
                                }}
                              >
                                <Badge
                                  variant={
                                    modelMetric === m ? "default" : "outline"
                                  }
                                  className="cursor-pointer text-xs"
                                >
                                  {m}
                                </Badge>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <KeyValueEditor
                        params={modelParams}
                        parameterHints={uiSchema?.parameter_hints}
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
                        shouldShowField={shouldShowField}
                      />
                    </>
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
            <AccordionTrigger className="text-sm font-medium hover:bg-muted/50">
              Evaluation
            </AccordionTrigger>
            <AccordionContent>
              <div className="pt-2">
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
