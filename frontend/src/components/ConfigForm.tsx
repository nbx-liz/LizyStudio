import { useCallback, useEffect, useState } from "react";
import {
  Accordion,
  NumberInput,
  Select,
  Switch,
  TextInput,
  Stack,
  Text,
  Button,
  Group,
} from "@mantine/core";

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  // Nested object sections
  [key: string]: unknown;
}

interface ConfigFormProps {
  schema: Record<string, unknown>;
  config: Record<string, unknown>;
  errors: Array<Record<string, unknown>>;
  onChange: (config: Record<string, unknown>) => void;
  onSave: (config: Record<string, unknown>) => void;
}

export function ConfigForm({
  schema,
  config,
  errors,
  onChange,
  onSave,
}: ConfigFormProps) {
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>(config);

  // Sync when external config changes (e.g. after import)
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const updateField = useCallback(
    (path: string[], value: unknown) => {
      const next = structuredClone(localConfig);
      let obj: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) {
        if (typeof obj[path[i]] !== "object" || obj[path[i]] === null) {
          obj[path[i]] = {};
        }
        obj = obj[path[i]] as Record<string, unknown>;
      }
      obj[path[path.length - 1]] = value;
      setLocalConfig(next);
      onChange(next);
    },
    [localConfig, onChange],
  );

  const typedSchema = schema as JsonSchema;
  const properties = typedSchema.properties ?? {};

  // Group top-level properties into accordion sections
  const sections = Object.entries(properties);

  return (
    <Stack gap="sm">
      <Accordion multiple defaultValue={sections.map(([key]) => key)}>
        {sections.map(([key, propSchema]) => {
          const s = propSchema as JsonSchema;
          if (s.type === "object" && s.properties) {
            // Nested object → accordion section
            return (
              <Accordion.Item key={key} value={key}>
                <Accordion.Control>{s.title ?? key}</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {Object.entries(s.properties).map(([subKey, subSchema]) => (
                      <SchemaField
                        key={subKey}
                        name={subKey}
                        schema={subSchema as JsonSchema}
                        value={getNestedValue(localConfig, [key, subKey])}
                        onChange={(v) => updateField([key, subKey], v)}
                      />
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          }
          // Top-level field
          return (
            <Accordion.Item key={key} value={key}>
              <Accordion.Control>{s.title ?? key}</Accordion.Control>
              <Accordion.Panel>
                <SchemaField
                  name={key}
                  schema={s}
                  value={localConfig[key]}
                  onChange={(v) => updateField([key], v)}
                />
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>

      {errors.length > 0 && (
        <Text size="xs" c="red">
          {errors.length} validation error(s)
        </Text>
      )}

      <Group>
        <Button size="sm" onClick={() => onSave(localConfig)}>
          Save Config
        </Button>
      </Group>
    </Stack>
  );
}

function SchemaField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = schema.title ?? name;
  const description = schema.description;

  // Enum → Select
  if (schema.enum) {
    return (
      <Select
        label={label}
        description={description}
        data={schema.enum.map((e) => String(e))}
        value={value != null ? String(value) : null}
        onChange={onChange}
        clearable
      />
    );
  }

  // Boolean → Switch
  if (schema.type === "boolean") {
    return (
      <Switch
        label={label}
        description={description}
        checked={value === true}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    );
  }

  // Number / Integer → NumberInput
  if (schema.type === "number" || schema.type === "integer") {
    return (
      <NumberInput
        label={label}
        description={description}
        value={typeof value === "number" ? value : undefined}
        onChange={(v) => onChange(v === "" ? undefined : v)}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === "integer" ? 1 : undefined}
        allowDecimal={schema.type !== "integer"}
      />
    );
  }

  // String → TextInput (default)
  return (
    <TextInput
      label={label}
      description={description}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.currentTarget.value || undefined)}
    />
  );
}

function getNestedValue(
  obj: Record<string, unknown>,
  path: string[],
): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
