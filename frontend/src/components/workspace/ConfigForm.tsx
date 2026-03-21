import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
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

// --- Field renderer ---

function renderField(
  rawProp: SchemaProperty,
  name: string,
  path: string[],
  value: unknown,
  onChange: (path: string[], value: unknown) => void,
  defs: Defs,
): ReactNode {
  const prop = resolveSchema(rawProp, defs, value);
  const label = prop.title ?? name;

  if (prop.const !== undefined) return null;

  // Skip free-form dicts (rendered by KeyValueEditor separately)
  if (
    prop.type === "object" &&
    !prop.properties &&
    prop.additionalProperties !== undefined
  ) {
    return null;
  }

  // Nested object — render as indented sub-group
  if (prop.type === "object" && prop.properties) {
    const namedProps = Object.entries(prop.properties).filter(
      ([, p]) => resolveSchema(p, defs).const === undefined,
    );
    if (namedProps.length === 0) return null;

    const objValue =
      value != null && typeof value === "object"
        ? (value as Record<string, unknown>)
        : ((prop.default as Record<string, unknown>) ?? {});
    return (
      <div key={name} className="space-y-2">
        <FormField label={label} description={prop.description}>
          <span />
        </FormField>
        <div className="space-y-2 border-l pl-3">
          {namedProps.map(([childName, childProp]) =>
            renderField(
              childProp as SchemaProperty,
              childName,
              [...path, childName],
              objValue[childName],
              onChange,
              defs,
            ),
          )}
        </div>
      </div>
    );
  }

  if (prop.enum && prop.enum.length > 0) {
    return (
      <FormField key={name} label={label} description={prop.description}>
        <Select
          value={String(value ?? prop.default ?? "")}
          onValueChange={(v) => onChange(path, v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {prop.enum.map((opt) => (
              <SelectItem key={String(opt)} value={String(opt)}>
                {String(opt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    );
  }

  if (prop.type === "boolean") {
    return (
      <FormField key={name} label={label} description={prop.description}>
        <Switch
          checked={
            value === true || (value === undefined && prop.default === true)
          }
          onCheckedChange={(checked) => onChange(path, checked)}
        />
      </FormField>
    );
  }

  if (prop.type === "number" || prop.type === "integer") {
    const numValue =
      value != null
        ? Number(value)
        : prop.default != null
          ? Number(prop.default)
          : 0;
    const hasRange = prop.minimum != null && prop.maximum != null;

    if (hasRange) {
      const min = prop.minimum as number;
      const max = prop.maximum as number;
      const step =
        prop.type === "integer" ? 1 : Math.max((max - min) / 100, 0.01);
      return (
        <div key={name} className="space-y-1">
          <FormField label={label} description={prop.description}>
            <span className="text-xs tabular-nums text-muted-foreground">
              {prop.type === "integer" ? numValue : numValue.toFixed(2)}
            </span>
          </FormField>
          <Slider
            min={min}
            max={max}
            step={step}
            value={[numValue]}
            onValueChange={([v]) => onChange(path, v)}
          />
        </div>
      );
    }

    const step = prop.type === "integer" ? 1 : 0.1;
    return (
      <FormField key={name} label={label} description={prop.description}>
        <NumberInput
          value={value != null ? Number(value) : undefined}
          onChange={(v) => onChange(path, v)}
          step={step}
          placeholder={prop.default != null ? String(prop.default) : undefined}
        />
      </FormField>
    );
  }

  if (prop.type === "array") {
    const arrValue = Array.isArray(value)
      ? value
      : ((prop.default as unknown[]) ?? []);
    return (
      <FormField key={name} label={label} description={prop.description}>
        <Input
          className="h-8 text-xs"
          placeholder="comma-separated values"
          value={arrValue.join(", ")}
          onChange={(e) => {
            const parts = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(path, parts);
          }}
        />
      </FormField>
    );
  }

  return (
    <FormField key={name} label={label} description={prop.description}>
      <Input
        className="h-8 w-32 text-xs"
        value={String(value ?? prop.default ?? "")}
        onChange={(e) => onChange(path, e.target.value)}
      />
    </FormField>
  );
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
            <AccordionItem key={sectionName} value={sectionName}>
              <AccordionTrigger className="text-sm font-medium">
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
                      <p className="text-xs text-muted-foreground font-medium mb-2">
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
                      <p className="text-xs text-muted-foreground font-medium mb-2">
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
          <AccordionItem value="evaluation">
            <AccordionTrigger className="text-sm font-medium">
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
