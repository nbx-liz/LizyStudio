import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type Defs, resolveSchema, type SchemaProperty } from "./config-utils";
import { FormField } from "./FormField";
import { NumberInput } from "./NumberInput";

type OnChange = (path: string[], value: unknown) => void;

const MAX_DEPTH = 5;

/** Fields to always hide regardless of nesting depth. */
const GLOBALLY_HIDDEN = new Set(["validation_ratio", "inner_valid"]);

/** Convert snake_case to Title Case (e.g. "early_stopping" → "Early Stopping") */
function humanize(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Derive a human-readable label from a JSON Schema property.
 * Pydantic v2 sets `title` to the model class name (e.g. "EarlyStoppingConfig")
 * which is not user-friendly. We prefer a humanized version of the field name,
 * unless the schema title looks intentionally user-facing (no "Config" suffix).
 */
function deriveLabel(prop: SchemaProperty, name: string): string {
  const title = prop.title;
  if (title && !title.endsWith("Config") && !title.endsWith("Schema")) {
    return title;
  }
  return humanize(name);
}

/** Max-depth fallback: raw JSON textarea. */
function renderDepthFallback(
  name: string,
  label: string,
  description: string | undefined,
  path: string[],
  value: unknown,
  onChange: OnChange,
): ReactNode {
  return (
    <FormField key={name} label={label} description={description}>
      <Textarea
        className="min-h-[60px] font-mono text-xs"
        value={value !== undefined ? JSON.stringify(value, null, 2) : ""}
        onChange={(e) => {
          try {
            onChange(path, JSON.parse(e.target.value));
          } catch {
            onChange(path, e.target.value);
          }
        }}
      />
    </FormField>
  );
}

/** Enum field: Select dropdown. */
export function renderEnumField(
  name: string,
  label: string,
  description: string | undefined,
  enumValues: unknown[],
  path: string[],
  value: unknown,
  defaultValue: unknown,
  onChange: OnChange,
): ReactNode {
  return (
    <FormField key={name} label={label} description={description}>
      <Select
        value={String(value ?? defaultValue ?? "")}
        onValueChange={(v) => onChange(path, v)}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {enumValues.map((opt) => (
            <SelectItem key={String(opt)} value={String(opt)}>
              {String(opt)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

/** Boolean field: Switch toggle. */
export function renderBooleanField(
  name: string,
  label: string,
  description: string | undefined,
  path: string[],
  value: unknown,
  defaultValue: unknown,
  onChange: OnChange,
): ReactNode {
  return (
    <FormField key={name} label={label} description={description}>
      <Switch
        checked={
          value === true || (value === undefined && defaultValue === true)
        }
        onCheckedChange={(checked) => onChange(path, checked)}
      />
    </FormField>
  );
}

/** Number/integer field: NumberInput with optional min/max range. */
export function renderNumberField(
  name: string,
  label: string,
  description: string | undefined,
  prop: SchemaProperty,
  path: string[],
  value: unknown,
  onChange: OnChange,
): ReactNode {
  const hasRange = prop.minimum != null && prop.maximum != null;

  if (hasRange) {
    const min = prop.minimum as number;
    const max = prop.maximum as number;
    const step =
      prop.type === "integer" ? 1 : Math.max((max - min) / 100, 0.01);
    return (
      <FormField key={name} label={label} description={description}>
        <div className="flex items-center gap-2">
          <NumberInput
            value={value != null ? Number(value) : undefined}
            onChange={(v) => onChange(path, v)}
            step={step}
            min={min}
            max={max}
            placeholder={
              prop.default != null ? String(prop.default) : undefined
            }
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {min}~{max}
          </span>
        </div>
      </FormField>
    );
  }

  const step = prop.type === "integer" ? 1 : 0.1;
  return (
    <FormField key={name} label={label} description={description}>
      <NumberInput
        value={value != null ? Number(value) : undefined}
        onChange={(v) => onChange(path, v)}
        step={step}
        placeholder={prop.default != null ? String(prop.default) : undefined}
      />
    </FormField>
  );
}

/** Array field: array-of-objects with Add/Remove, or primitive comma-separated. */
function renderArrayField(
  name: string,
  label: string,
  description: string | undefined,
  prop: SchemaProperty,
  path: string[],
  value: unknown,
  onChange: OnChange,
  defs: Defs,
  depth: number,
  renderField: (
    rawProp: SchemaProperty,
    name: string,
    path: string[],
    value: unknown,
    onChange: OnChange,
    defs: Defs,
    depth?: number,
  ) => ReactNode,
): ReactNode {
  const arrValue = Array.isArray(value)
    ? value
    : ((prop.default as unknown[]) ?? []);

  // Array of objects
  if (prop.items?.type === "object" && prop.items.properties) {
    // HIGH-9: avoid bare index keys. On Remove, React would otherwise
    // keep the trailing child components' state on the wrong row. Use
    // a content-derived key plus the index so that (a) removing a row
    // shifts the key for subsequent rows along with their state, and
    // (b) duplicate structural items still remain distinguishable.
    const itemKey = (item: Record<string, unknown>, idx: number) => {
      try {
        return `${idx}-${JSON.stringify(item)}`;
      } catch {
        return `${idx}`;
      }
    };
    return (
      <div key={name} className="space-y-2">
        <FormField label={label} description={description}>
          <span />
        </FormField>
        <div className="space-y-3">
          {(arrValue as Record<string, unknown>[]).map((item, idx) => (
            <div
              key={itemKey(item, idx)}
              className="space-y-2 border-l pl-3 relative"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">
                  Item {idx + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive"
                  onClick={() => {
                    const updated = [
                      ...arrValue.slice(0, idx),
                      ...arrValue.slice(idx + 1),
                    ];
                    onChange(path, updated);
                  }}
                >
                  Remove
                </Button>
              </div>
              {Object.entries(prop.items?.properties ?? {}).map(
                ([childName, childProp]) =>
                  renderField(
                    childProp as SchemaProperty,
                    childName,
                    [...path, String(idx), childName],
                    item[childName],
                    onChange,
                    defs,
                    depth + 1,
                  ),
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            const defaultItem = Object.fromEntries(
              Object.entries(prop.items?.properties ?? {}).map(([k, p]) => [
                k,
                (p as SchemaProperty).default ?? null,
              ]),
            );
            onChange(path, [...arrValue, defaultItem]);
          }}
        >
          + Add item
        </Button>
      </div>
    );
  }

  // Primitive array — comma-separated input
  return (
    <FormField key={name} label={label} description={description}>
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

/** Nested object field: indented sub-group. */
function renderObjectField(
  name: string,
  label: string,
  description: string | undefined,
  prop: SchemaProperty,
  path: string[],
  value: unknown,
  onChange: OnChange,
  defs: Defs,
  depth: number,
  renderField: (
    rawProp: SchemaProperty,
    name: string,
    path: string[],
    value: unknown,
    onChange: OnChange,
    defs: Defs,
    depth?: number,
  ) => ReactNode,
): ReactNode {
  const namedProps = Object.entries(prop.properties ?? {}).filter(
    ([, p]) => resolveSchema(p, defs).const === undefined,
  );
  if (namedProps.length === 0) return null;

  const objValue =
    value != null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : ((prop.default as Record<string, unknown>) ?? {});
  return (
    <div key={name} className="space-y-2">
      <FormField label={label} description={description}>
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
            depth + 1,
          ),
        )}
      </div>
    </div>
  );
}

/** Discriminated union: type selector with nested fields. */
function renderDiscriminatedUnion(
  name: string,
  label: string,
  description: string | undefined,
  prop: SchemaProperty,
  path: string[],
  value: unknown,
  onChange: OnChange,
  defs: Defs,
  depth: number,
  renderField: (
    rawProp: SchemaProperty,
    name: string,
    path: string[],
    value: unknown,
    onChange: OnChange,
    defs: Defs,
    depth?: number,
  ) => ReactNode,
): ReactNode {
  const alternatives = prop.alternatives ?? [];
  const selectedTitle =
    (value != null && typeof value === "object" ? prop.title : undefined) ??
    alternatives[0].title ??
    alternatives[0].type;
  const selectedIdx = alternatives.findIndex(
    (alt) => (alt.title ?? alt.type) === selectedTitle,
  );
  const activeIdx = selectedIdx >= 0 ? selectedIdx : 0;
  const activeAlt = alternatives[activeIdx];

  return (
    <div key={name} className="space-y-2">
      <FormField label={label} description={description}>
        <Select
          value={String(activeIdx)}
          onValueChange={(v) => {
            const idx = Number(v);
            const alt = alternatives[idx];
            if (!alt) return;
            onChange(path, alt.default ?? {});
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {alternatives.map((alt, idx) => (
              <SelectItem key={idx} value={String(idx)}>
                {alt.title ?? alt.type ?? `Option ${idx + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {activeAlt.properties && (
        <div className="space-y-2 border-l pl-3">
          {Object.entries(activeAlt.properties)
            .filter(([, p]) => resolveSchema(p, defs).const === undefined)
            .map(([childName, childProp]) => {
              const childValue =
                value != null && typeof value === "object"
                  ? (value as Record<string, unknown>)[childName]
                  : undefined;
              return renderField(
                childProp as SchemaProperty,
                childName,
                [...path, childName],
                childValue,
                onChange,
                defs,
                depth + 1,
              );
            })}
        </div>
      )}
    </div>
  );
}

/** Default fallback: plain text Input. */
function renderStringFallback(
  name: string,
  label: string,
  description: string | undefined,
  path: string[],
  value: unknown,
  defaultValue: unknown,
  onChange: OnChange,
): ReactNode {
  return (
    <FormField key={name} label={label} description={description}>
      <Input
        className="h-8 w-32 text-xs"
        value={String(value ?? defaultValue ?? "")}
        onChange={(e) => onChange(path, e.target.value)}
      />
    </FormField>
  );
}

/**
 * Main field dispatcher. Resolves the schema property and delegates
 * to the appropriate type-specific renderer.
 */
export function renderField(
  rawProp: SchemaProperty,
  name: string,
  path: string[],
  value: unknown,
  onChange: OnChange,
  defs: Defs,
  depth = 0,
): ReactNode {
  const prop = resolveSchema(rawProp, defs, value);
  const label = deriveLabel(prop, name);

  if (prop.const !== undefined) return null;
  if (GLOBALLY_HIDDEN.has(name)) return null;

  if (depth >= MAX_DEPTH) {
    return renderDepthFallback(
      name,
      label,
      prop.description,
      path,
      value,
      onChange,
    );
  }

  // Skip free-form dicts (rendered by KeyValueEditor separately)
  if (
    prop.type === "object" &&
    !prop.properties &&
    prop.additionalProperties !== undefined
  ) {
    return null;
  }

  // Discriminated union
  if (prop.alternatives && prop.alternatives.length > 1) {
    return renderDiscriminatedUnion(
      name,
      label,
      prop.description,
      prop,
      path,
      value,
      onChange,
      defs,
      depth,
      renderField,
    );
  }

  // Nested object
  if (prop.type === "object" && prop.properties) {
    return renderObjectField(
      name,
      label,
      prop.description,
      prop,
      path,
      value,
      onChange,
      defs,
      depth,
      renderField,
    );
  }

  // Enum
  if (prop.enum && prop.enum.length > 0) {
    return renderEnumField(
      name,
      label,
      prop.description,
      prop.enum,
      path,
      value,
      prop.default,
      onChange,
    );
  }

  // Boolean
  if (prop.type === "boolean") {
    return renderBooleanField(
      name,
      label,
      prop.description,
      path,
      value,
      prop.default,
      onChange,
    );
  }

  // Number / integer
  if (prop.type === "number" || prop.type === "integer") {
    return renderNumberField(
      name,
      label,
      prop.description,
      prop,
      path,
      value,
      onChange,
    );
  }

  // Array
  if (prop.type === "array") {
    return renderArrayField(
      name,
      label,
      prop.description,
      prop,
      path,
      value,
      onChange,
      defs,
      depth,
      renderField,
    );
  }

  // Fallback: string / unknown
  return renderStringFallback(
    name,
    label,
    prop.description,
    path,
    value,
    prop.default,
    onChange,
  );
}
