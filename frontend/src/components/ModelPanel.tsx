import { useState, useCallback, useEffect, useRef } from "react";
import {
  Accordion,
  Badge,
  Button,
  Group,
  JsonInput,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchConfig,
  fetchConfigSchema,
  updateConfig,
  uploadConfig,
  validateConfig,
  downloadConfigUrl,
} from "../api/config";
import { ConfigForm } from "./ConfigForm";

export function ModelPanel() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string | null>("fit");
  const [errors, setErrors] = useState<Array<Record<string, unknown>>>([]);

  const schemaQuery = useQuery({
    queryKey: ["config-schema"],
    queryFn: fetchConfigSchema,
  });

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
  });

  // Debounce timer for auto-validation
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onConfigChange = useCallback(
    (config: Record<string, unknown>) => {
      // Debounced auto-validation
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await validateConfig(config);
          setErrors(res.errors);
        } catch {
          // Ignore validation errors during typing
        }
      }, 500);
    },
    [],
  );

  const onSaveConfig = useCallback(
    async (config: Record<string, unknown>) => {
      try {
        const res = await updateConfig(config);
        setErrors(res.errors);
        queryClient.invalidateQueries({ queryKey: ["config"] });
        if (res.errors.length === 0) {
          notifications.show({
            title: "Config saved",
            message: "Configuration updated successfully",
            color: "green",
          });
        }
      } catch (e) {
        notifications.show({
          title: "Save failed",
          message: String(e),
          color: "red",
        });
      }
    },
    [queryClient],
  );

  const onImportYaml = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const res = await uploadConfig(file);
        setErrors(res.errors);
        queryClient.invalidateQueries({ queryKey: ["config"] });
        notifications.show({
          title: "Config imported",
          message: `Loaded from ${file.name}`,
          color: "green",
        });
      } catch (e) {
        notifications.show({
          title: "Import failed",
          message: String(e),
          color: "red",
        });
      }
    };
    input.click();
  }, [queryClient]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const schema = schemaQuery.data;
  const config = configQuery.data ?? {};

  return (
    <Paper p="md" withBorder>
      {/* Sticky header */}
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Title order={5}>Model</Title>
          <Badge size="sm" variant="light">
            lizyml
          </Badge>
        </Group>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="fit">Fit</Tabs.Tab>
          <Tabs.Tab value="tune">Tune</Tabs.Tab>
        </Tabs.List>

        {/* Fit Tab */}
        <Tabs.Panel value="fit" pt="sm">
          <Stack gap="sm">
            {schema ? (
              <ConfigForm
                schema={schema}
                config={config}
                errors={errors}
                onChange={onConfigChange}
                onSave={onSaveConfig}
              />
            ) : (
              <Text c="dimmed" size="sm">
                Loading schema...
              </Text>
            )}
          </Stack>
        </Tabs.Panel>

        {/* Tune Tab */}
        <Tabs.Panel value="tune" pt="sm">
          <Stack gap="sm">
            <Accordion>
              <Accordion.Item value="model">
                <Accordion.Control>Model</Accordion.Control>
                <Accordion.Panel>
                  <Text size="sm" c="dimmed">
                    Model selection for tuning. Shared with Fit tab.
                  </Text>
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item value="settings">
                <Accordion.Control>Settings</Accordion.Control>
                <Accordion.Panel>
                  <Text size="sm" c="dimmed">
                    Tuning settings (n_trials, timeout, scoring). Full implementation in Phase 5.
                  </Text>
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item value="search-space">
                <Accordion.Control>Search Space</Accordion.Control>
                <Accordion.Panel>
                  <Text size="sm" c="dimmed">
                    Search space editor. Full implementation in Phase 5.
                  </Text>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {/* Import / Export / Raw */}
      <Group mt="md" gap="xs">
        <Button size="xs" variant="light" onClick={onImportYaml}>
          Import YAML
        </Button>
        <Button
          size="xs"
          variant="light"
          component="a"
          href={downloadConfigUrl()}
          download="config.yaml"
        >
          Export YAML
        </Button>
        <RawConfigToggle config={config} onSave={onSaveConfig} />
      </Group>
    </Paper>
  );
}

function RawConfigToggle({
  config,
  onSave,
}: {
  config: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");

  useEffect(() => {
    setRaw(JSON.stringify(config, null, 2));
  }, [config]);

  if (!open) {
    return (
      <Button size="xs" variant="subtle" onClick={() => setOpen(true)}>
        Raw Config
      </Button>
    );
  }

  return (
    <Stack gap="xs" mt="sm" style={{ width: "100%" }}>
      <JsonInput
        value={raw}
        onChange={setRaw}
        autosize
        minRows={6}
        maxRows={20}
        formatOnBlur
        validationError="Invalid JSON"
      />
      <Group gap="xs">
        <Button
          size="xs"
          onClick={() => {
            try {
              onSave(JSON.parse(raw));
              setOpen(false);
            } catch {
              notifications.show({
                title: "Invalid JSON",
                message: "Could not parse config",
                color: "red",
              });
            }
          }}
        >
          Apply
        </Button>
        <Button size="xs" variant="subtle" onClick={() => setOpen(false)}>
          Close
        </Button>
      </Group>
    </Stack>
  );
}
