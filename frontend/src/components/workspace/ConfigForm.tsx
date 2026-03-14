import { useCallback, useMemo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { FormField } from "./FormField";
import { KeyValueEditor } from "./KeyValueEditor";
import { MetricsChips } from "./MetricsChips";
import { NumberInput } from "./NumberInput";

// --- Schema types ---

interface SchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  anyOf?: SchemaProperty[];
  oneOf?: SchemaProperty[];
  discriminator?: { propertyName?: string };
  additionalProperties?: boolean | SchemaProperty;
  nullable?: boolean;
}

type Defs = Record<string, SchemaProperty>;

interface ConfigFormProps {
  schema: Record<string, unknown>;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  hiddenFields?: string[];
  task?: string | null;
  uiSchema?: import("@/api/types").UiSchema;
}

// --- Schema resolution ---

function resolveSchema(
  prop: SchemaProperty,
  defs: Defs,
  currentValue?: unknown,
  _visited: Set<string> = new Set(),
): SchemaProperty {
  if (prop.$ref) {
    if (_visited.has(prop.$ref)) return prop; // cycle guard
    const nextVisited = new Set(_visited).add(prop.$ref);
    const refName = prop.$ref.replace("#/$defs/", "");
    const resolved = defs[refName];
    if (resolved) {
      return {
        ...resolveSchema(resolved, defs, currentValue, nextVisited),
        ...(prop.title ? { title: prop.title } : {}),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(prop.description ? { description: prop.description } : {}),
      };
    }
  }

  if (prop.anyOf) {
    const hasNull = prop.anyOf.some((v) => v.type === "null");
    const nonNull = prop.anyOf.filter(
      (v) =>
        v.type !== "null" &&
        (v.type !== undefined || v.$ref || v.oneOf || v.anyOf),
    );
    const effectiveValue = currentValue ?? prop.default;

    if (nonNull.length === 1) {
      const resolved = resolveSchema(
        nonNull[0],
        defs,
        effectiveValue,
        _visited,
      );
      return {
        ...resolved,
        ...(prop.title ? { title: prop.title } : {}),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(prop.description ? { description: prop.description } : {}),
        ...(hasNull ? { nullable: true } : {}),
      };
    }
    const withOneOf = nonNull.find((v) => v.oneOf || v.$ref);
    if (withOneOf) {
      return resolveSchema(
        {
          ...withOneOf,
          ...(prop.title ? { title: prop.title } : {}),
          ...(prop.default !== undefined ? { default: prop.default } : {}),
          ...(hasNull ? { nullable: true } : {}),
        },
        defs,
        effectiveValue,
        _visited,
      );
    }
    if (nonNull.length > 0) {
      return {
        ...resolveSchema(nonNull[0], defs, effectiveValue, _visited),
        ...(hasNull ? { nullable: true } : {}),
      };
    }
  }

  if (prop.oneOf && prop.discriminator?.propertyName) {
    const discKey = prop.discriminator.propertyName;
    const effectiveValue = currentValue ?? prop.default;
    const currentObj =
      effectiveValue != null && typeof effectiveValue === "object"
        ? (effectiveValue as Record<string, unknown>)
        : null;
    const discValue = currentObj?.[discKey];

    for (const variant of prop.oneOf) {
      const resolved = resolveSchema(variant, defs, currentValue, _visited);
      const constVal = resolved.properties?.[discKey]?.const;
      if (constVal !== undefined && String(constVal) === String(discValue)) {
        return { ...resolved, ...(prop.title ? { title: prop.title } : {}) };
      }
    }
    if (prop.oneOf.length > 0) {
      const resolved = resolveSchema(
        prop.oneOf[0],
        defs,
        currentValue,
        _visited,
      );
      return { ...resolved, ...(prop.title ? { title: prop.title } : {}) };
    }
  }

  if (prop.oneOf && !prop.discriminator && prop.oneOf.length > 0) {
    const resolved = resolveSchema(prop.oneOf[0], defs, currentValue, _visited);
    return {
      ...resolved,
      ...(prop.title ? { title: prop.title } : {}),
      ...(prop.default !== undefined ? { default: prop.default } : {}),
    };
  }

  return prop;
}

function resolveProperties(
  props: Record<string, SchemaProperty>,
  defs: Defs,
  values: Record<string, unknown>,
): Record<string, SchemaProperty> {
  const result: Record<string, SchemaProperty> = {};
  for (const [name, prop] of Object.entries(props)) {
    result[name] = resolveSchema(prop, defs, values[name]);
  }
  return result;
}

// --- Value helpers ---

function getNestedValue(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const result = { ...obj };
  if (path.length === 1) {
    result[path[0]] = value;
    return result;
  }
  const [first, ...rest] = path;
  result[first] = setNestedValue(
    (result[first] as Record<string, unknown>) ?? {},
    rest,
    value,
  );
  return result;
}

// --- Field renderer ---

function renderField(
  rawProp: SchemaProperty,
  name: string,
  path: string[],
  value: unknown,
  onChange: (path: string[], value: unknown) => void,
  defs: Defs,
): React.ReactNode {
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

  // Nullable Auto chip support
  const isNullable = prop.nullable === true;
  const isAuto = isNullable && value === null;
  const autoValue = isNullable
    ? {
        isAuto,
        onToggle: () => {
          if (isAuto) {
            onChange(path, prop.default ?? 0);
          } else {
            onChange(path, null);
          }
        },
      }
    : undefined;

  if (prop.enum && prop.enum.length > 0) {
    return (
      <FormField
        key={name}
        label={label}
        description={prop.description}
        autoValue={autoValue}
      >
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
      <FormField
        key={name}
        label={label}
        description={prop.description}
        autoValue={autoValue}
      >
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
      <FormField
        key={name}
        label={label}
        description={prop.description}
        autoValue={autoValue}
      >
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
    <FormField
      key={name}
      label={label}
      description={prop.description}
      autoValue={autoValue}
    >
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

export function ConfigForm({
  schema,
  config,
  onChange,
  hiddenFields = HIDDEN,
  task,
  uiSchema,
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

  if (!rawProperties) return null;

  // Separate sections
  const sections: [string, SchemaProperty][] = [];
  const fields: [string, SchemaProperty][] = [];

  for (const [name, prop] of Object.entries(properties)) {
    if (hiddenFields.includes(name)) continue;
    if (DATA_PANEL_FIELDS.includes(name)) continue;
    if (name === "calibration") continue; // Handled by CalibrationSection
    if (prop.type === "object" && prop.properties) {
      sections.push([name, prop]);
    } else {
      fields.push([name, prop]);
    }
  }

  // Model params from config
  const modelConfig = (config.model as Record<string, unknown>) ?? {};
  const modelName = (modelConfig.name as string) ?? "lgbm";
  const modelParams = (modelConfig.params as Record<string, unknown>) ?? {};

  // Evaluation metrics from config
  const evalConfig = (config.evaluation as Record<string, unknown>) ?? {};
  const selectedMetrics = Array.isArray(evalConfig.metrics)
    ? (evalConfig.metrics as string[])
    : [];

  // Calibration from config
  const calibration =
    config.calibration !== undefined
      ? (config.calibration as Record<string, unknown> | null)
      : null;

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

                  {/* model.params Key-Value editor */}
                  {sectionName === "model" && (
                    <>
                      <Separator className="my-3" />
                      <KeyValueEditor
                        params={modelParams}
                        parameterHints={uiSchema?.parameter_hints}
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
                    </>
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
