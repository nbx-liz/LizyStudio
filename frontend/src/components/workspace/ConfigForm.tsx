import { Minus, Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

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
}

type Defs = Record<string, SchemaProperty>;

interface ConfigFormProps {
  schema: Record<string, unknown>;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  hiddenFields?: string[];
  task?: string | null;
}

/** Resolve $ref, anyOf, oneOf into a concrete SchemaProperty. */
function resolveSchema(
  prop: SchemaProperty,
  defs: Defs,
  currentValue?: unknown,
): SchemaProperty {
  // Resolve $ref
  if (prop.$ref) {
    const refName = prop.$ref.replace("#/$defs/", "");
    const resolved = defs[refName];
    if (resolved) {
      // Merge title/default/description from the referencing property
      return {
        ...resolveSchema(resolved, defs, currentValue),
        ...(prop.title ? { title: prop.title } : {}),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(prop.description ? { description: prop.description } : {}),
      };
    }
  }

  // Resolve anyOf — pick the non-null variant
  if (prop.anyOf) {
    const nonNull = prop.anyOf.filter(
      (v) =>
        v.type !== "null" &&
        (v.type !== undefined || v.$ref || v.oneOf || v.anyOf),
    );
    // Use currentValue if available, fall back to prop.default
    const effectiveValue = currentValue ?? prop.default;
    if (nonNull.length === 1) {
      const resolved = resolveSchema(nonNull[0], defs, effectiveValue);
      return {
        ...resolved,
        ...(prop.title ? { title: prop.title } : {}),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(prop.description ? { description: prop.description } : {}),
      };
    }
    // Multiple non-null variants — check for oneOf inside
    const withOneOf = nonNull.find((v) => v.oneOf || v.$ref);
    if (withOneOf) {
      return resolveSchema(
        {
          ...withOneOf,
          ...(prop.title ? { title: prop.title } : {}),
          ...(prop.default !== undefined ? { default: prop.default } : {}),
        },
        defs,
        effectiveValue,
      );
    }
    // Fallback: try first non-null
    if (nonNull.length > 0) {
      return resolveSchema(nonNull[0], defs, effectiveValue);
    }
  }

  // Resolve oneOf with discriminator — pick variant matching current value
  if (prop.oneOf && prop.discriminator?.propertyName) {
    const discKey = prop.discriminator.propertyName;
    // Use currentValue if available, fall back to prop.default for matching
    const effectiveValue = currentValue ?? prop.default;
    const currentObj =
      effectiveValue != null && typeof effectiveValue === "object"
        ? (effectiveValue as Record<string, unknown>)
        : null;
    const discValue = currentObj?.[discKey];

    for (const variant of prop.oneOf) {
      const resolved = resolveSchema(variant, defs, currentValue);
      const constVal = resolved.properties?.[discKey]?.const;
      if (constVal !== undefined && String(constVal) === String(discValue)) {
        return {
          ...resolved,
          ...(prop.title ? { title: prop.title } : {}),
        };
      }
    }
    // No match — use first variant
    if (prop.oneOf.length > 0) {
      const resolved = resolveSchema(prop.oneOf[0], defs, currentValue);
      return {
        ...resolved,
        ...(prop.title ? { title: prop.title } : {}),
      };
    }
  }

  // Resolve oneOf without discriminator — use first variant
  if (prop.oneOf && !prop.discriminator && prop.oneOf.length > 0) {
    const resolved = resolveSchema(prop.oneOf[0], defs, currentValue);
    return {
      ...resolved,
      ...(prop.title ? { title: prop.title } : {}),
      ...(prop.default !== undefined ? { default: prop.default } : {}),
    };
  }

  return prop;
}

/** Pre-resolve all properties in a schema recursively. */
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

  // Skip const fields (e.g., discriminator "name": "lgbm")
  if (prop.const !== undefined) {
    return null;
  }

  // Skip free-form dicts (additionalProperties with no named properties)
  if (
    prop.type === "object" &&
    !prop.properties &&
    prop.additionalProperties !== undefined
  ) {
    return null;
  }

  // Nested object — render as indented sub-group
  if (prop.type === "object" && prop.properties) {
    // Skip objects with only const properties (no editable fields)
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
        <Label className="text-xs font-semibold">{label}</Label>
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
      <div key={name} className="space-y-1">
        <Label className="text-xs" title={prop.description}>
          {label}
        </Label>
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
      </div>
    );
  }

  if (prop.type === "boolean") {
    return (
      <div key={name} className="flex items-center justify-between">
        <Label className="text-xs" title={prop.description}>
          {label}
        </Label>
        <Switch
          checked={
            value === true || (value === undefined && prop.default === true)
          }
          onCheckedChange={(checked) => onChange(path, checked)}
        />
      </div>
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
          <div className="flex items-center justify-between">
            <Label className="text-xs" title={prop.description}>
              {label}
            </Label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {prop.type === "integer" ? numValue : numValue.toFixed(2)}
            </span>
          </div>
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

    // Stepper for numbers without min/max
    const step = prop.type === "integer" ? 1 : 0.1;
    return (
      <div key={name} className="space-y-1">
        <Label className="text-xs" title={prop.description}>
          {label}
        </Label>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => onChange(path, numValue - step)}
          >
            <Minus />
          </Button>
          <Input
            type="number"
            className="h-6 text-center text-xs"
            value={String(value ?? prop.default ?? "")}
            step={step}
            onChange={(e) => {
              const v = e.target.value;
              onChange(
                path,
                v === ""
                  ? undefined
                  : prop.type === "integer"
                    ? Number.parseInt(v, 10)
                    : Number.parseFloat(v),
              );
            }}
          />
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => onChange(path, numValue + step)}
          >
            <Plus />
          </Button>
        </div>
      </div>
    );
  }

  if (prop.type === "array") {
    const arrValue = Array.isArray(value)
      ? value
      : ((prop.default as unknown[]) ?? []);
    return (
      <div key={name} className="space-y-1">
        <Label className="text-xs" title={prop.description}>
          {label}
        </Label>
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
      </div>
    );
  }

  // string
  return (
    <div key={name} className="space-y-1">
      <Label className="text-xs" title={prop.description}>
        {label}
      </Label>
      <Input
        className="h-8 text-xs"
        value={String(value ?? prop.default ?? "")}
        onChange={(e) => onChange(path, e.target.value)}
      />
    </div>
  );
}

export function ConfigForm({
  schema,
  config,
  onChange,
  hiddenFields = ["config_version"],
  task,
}: ConfigFormProps) {
  const handleFieldChange = useCallback(
    (path: string[], value: unknown) => {
      const updated = setNestedValue(config, path, value);
      onChange(updated);
    },
    [config, onChange],
  );

  const defs = ((schema as { $defs?: Defs }).$defs ?? {}) as Defs;
  const rawProperties = (
    schema as { properties?: Record<string, SchemaProperty> }
  ).properties;

  const properties = useMemo(
    () => (rawProperties ? resolveProperties(rawProperties, defs, config) : {}),
    [rawProperties, defs, config],
  );

  if (!rawProperties) return null;

  // Group into sections (objects) and top-level fields
  const sections: [string, SchemaProperty][] = [];
  const fields: [string, SchemaProperty][] = [];

  for (const [name, prop] of Object.entries(properties)) {
    if (hiddenFields.includes(name)) continue;
    // Skip data/features/split — managed by DataPanel
    if (["data", "features", "split"].includes(name)) continue;
    if (name === "calibration" && task && task !== "binary") continue;
    if (prop.type === "object" && prop.properties) {
      sections.push([name, prop]);
    } else {
      fields.push([name, prop]);
    }
  }

  return (
    <div className="space-y-4">
      {fields.length > 0 && (
        <div className="space-y-2">
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
      {sections.length > 0 && (
        <Accordion type="multiple" defaultValue={sections.map(([n]) => n)}>
          {sections.map(([sectionName, sectionProp]) => {
            const sectionValue =
              (config[sectionName] as Record<string, unknown>) ??
              (sectionProp.default as Record<string, unknown>) ??
              {};
            return (
              <AccordionItem key={sectionName} value={sectionName}>
                <AccordionTrigger className="text-sm">
                  {sectionProp.title ?? sectionName}
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
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
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
