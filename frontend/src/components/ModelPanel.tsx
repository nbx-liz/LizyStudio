import { useState, useCallback, useEffect, useRef } from "react";
import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconTrash, IconPlus } from "@tabler/icons-react";
import { toYaml } from "../utils/toYaml";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchConfig,
  fetchConfigSchema,
  updateConfig as updateConfigApi,
  uploadConfig,
  validateConfig,
  downloadConfigUrl,
} from "../api/config";
import { fetchBackends } from "../api/backends";
import { ConfigForm } from "./ConfigForm";

// --- Types for search space editing ---

type SearchSpaceMode = "fixed" | "range" | "choice";

interface SearchSpaceEntry {
  name: string;
  mode: SearchSpaceMode;
  fixedValue: string;
  rangeMin: string;
  rangeMax: string;
  rangeStep: string;
  distribution: "uniform" | "log-uniform";
  choiceValues: string;
}

interface ModelPanelProps {
  onFit?: () => void;
  onTune?: () => void;
  running?: boolean;
  hasData?: boolean;
}

export function ModelPanel({ onFit, onTune, running, hasData }: ModelPanelProps) {
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

  // Mutation for config updates (shared by Fit, Tune, Calibration)
  const updateConfigMutation = useMutation({
    mutationFn: updateConfigApi,
    onSuccess: (res) => {
      setErrors(res.errors);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      if (res.errors.length === 0) {
        notifications.show({
          title: "Config saved",
          message: "Configuration updated successfully",
          color: "green",
        });
      }
    },
    onError: (e) => {
      notifications.show({
        title: "Save failed",
        message: String(e),
        color: "red",
      });
    },
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
        const res = await updateConfigApi(config);
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

  const backendsQuery = useQuery({
    queryKey: ["backends"],
    queryFn: fetchBackends,
    staleTime: Infinity,
  });

  const schema = schemaQuery.data;
  const config = configQuery.data ?? {};

  // Check if search space has any Range/Choice entries for Tune enable condition
  const hasTunableParams = hasRangeOrChoice(config);

  // Fit enable condition: data loaded + model selected (BLUEPRINT §4.2.2)
  const hasModel = !!(
    config.model &&
    typeof config.model === "object" &&
    (config.model as Record<string, unknown>).name
  );
  const fitEnabled = hasData !== false && hasModel;

  // Backend label from API
  const backendInfo = backendsQuery.data?.[0];
  const backendLabel = backendInfo
    ? `${backendInfo.name} v${backendInfo.version}`
    : "lizyml";

  return (
    <Paper p="md" withBorder>
      {/* Sticky header */}
      <Group
        justify="space-between"
        mb="sm"
        style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--mantine-color-body)" }}
        py="xs"
      >
        <Group gap="xs">
          <Title order={5}>Model</Title>
          <Badge size="sm" variant="light">
            {backendLabel}
          </Badge>
        </Group>
        {activeTab === "fit" ? (
          <Button size="xs" onClick={onFit} loading={running} disabled={!fitEnabled}>
            Fit
          </Button>
        ) : (
          <Button
            size="xs"
            onClick={onTune}
            loading={running}
            disabled={!hasTunableParams}
            title={hasTunableParams ? undefined : "Add at least one Range or Choice parameter"}
          >
            Tune
          </Button>
        )}
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
            {/* Calibration — only for binary classification */}
            <CalibrationSection
              config={config}
              onUpdate={(next) => updateConfigMutation.mutate(next)}
            />
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
                  <TuneSettingsSection
                    config={config}
                    onUpdate={(next) => updateConfigMutation.mutate(next)}
                  />
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item value="search-space">
                <Accordion.Control>Search Space</Accordion.Control>
                <Accordion.Panel>
                  <SearchSpaceSection
                    config={config}
                    onUpdate={(next) => updateConfigMutation.mutate(next)}
                  />
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
        <RawConfigToggle config={config} />
      </Group>
    </Paper>
  );
}

// --- Tune Settings Section (12.1a) ---

function TuneSettingsSection({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  const tuning = (config.tuning ?? {}) as Record<string, unknown>;

  const nTrials = String(tuning.n_trials ?? "100");
  const timeout = String(tuning.timeout ?? "600");
  const scoring = typeof tuning.scoring === "string" ? tuning.scoring : "";

  const updateTuningField = useCallback(
    (field: string, value: unknown) => {
      const next = structuredClone(config);
      if (typeof next.tuning !== "object" || next.tuning === null) {
        next.tuning = {};
      }
      (next.tuning as Record<string, unknown>)[field] = value;
      onUpdate(next);
    },
    [config, onUpdate],
  );

  return (
    <Stack gap="sm">
      <Select
        label="Number of trials"
        data={[
          { value: "50", label: "50" },
          { value: "100", label: "100" },
          { value: "200", label: "200" },
          { value: "500", label: "500" },
        ]}
        value={nTrials}
        onChange={(v) => updateTuningField("n_trials", v ? Number(v) : 100)}
      />
      <Select
        label="Timeout"
        data={[
          { value: "300", label: "5 min" },
          { value: "600", label: "10 min" },
          { value: "1800", label: "30 min" },
          { value: "3600", label: "1 hour" },
        ]}
        value={timeout}
        onChange={(v) => updateTuningField("timeout", v ? Number(v) : 600)}
      />
      <Select
        label="Scoring"
        placeholder="Select metric"
        data={[
          { value: "auc", label: "AUC" },
          { value: "log_loss", label: "Log Loss" },
          { value: "accuracy", label: "Accuracy" },
          { value: "f1", label: "F1" },
          { value: "rmse", label: "RMSE" },
          { value: "mae", label: "MAE" },
          { value: "r2", label: "R²" },
        ]}
        value={scoring || null}
        onChange={(v) => updateTuningField("scoring", v || undefined)}
        searchable
        clearable
      />
    </Stack>
  );
}

// --- Search Space Section (12.1b) ---

const DEFAULT_PARAMS = [
  "n_estimators",
  "learning_rate",
  "max_depth",
  "num_leaves",
  "min_child_samples",
];

function createDefaultEntry(name: string): SearchSpaceEntry {
  return {
    name,
    mode: "fixed",
    fixedValue: "",
    rangeMin: "",
    rangeMax: "",
    rangeStep: "",
    distribution: "uniform",
    choiceValues: "",
  };
}

function SearchSpaceSection({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  const [entries, setEntries] = useState<SearchSpaceEntry[]>(() =>
    DEFAULT_PARAMS.map(createDefaultEntry),
  );

  const updateEntry = useCallback(
    (index: number, patch: Partial<SearchSpaceEntry>) => {
      setEntries((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
    [],
  );

  const addEntry = useCallback(() => {
    setEntries((prev) => [...prev, createDefaultEntry("")]);
  }, []);

  const removeEntry = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onSave = useCallback(() => {
    // Convert local state to config-compatible format
    const searchSpace: Record<string, unknown> = {};
    for (const entry of entries) {
      if (!entry.name.trim()) continue;
      switch (entry.mode) {
        case "fixed":
          searchSpace[entry.name] = parseNumericOrString(entry.fixedValue);
          break;
        case "range": {
          const rangeObj: Record<string, unknown> = {
            low: parseFloat(entry.rangeMin) || 0,
            high: parseFloat(entry.rangeMax) || 1,
          };
          if (entry.rangeStep.trim()) {
            rangeObj.step = parseFloat(entry.rangeStep);
          }
          if (entry.distribution === "log-uniform") {
            rangeObj.log = true;
          }
          searchSpace[entry.name] = rangeObj;
          break;
        }
        case "choice":
          searchSpace[entry.name] = entry.choiceValues
            .split(",")
            .map((v) => parseNumericOrString(v.trim()))
            .filter((v) => v !== "");
          break;
      }
    }

    const next = structuredClone(config);
    if (typeof next.tuning !== "object" || next.tuning === null) {
      next.tuning = {};
    }
    (next.tuning as Record<string, unknown>).search_space = searchSpace;
    onUpdate(next);
  }, [entries, config, onUpdate]);

  return (
    <Stack gap="sm">
      <Table fz="xs" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Parameter</Table.Th>
            <Table.Th>Mode</Table.Th>
            <Table.Th>Value(s)</Table.Th>
            <Table.Th w={40} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map((entry, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <TextInput
                  size="xs"
                  value={entry.name}
                  onChange={(e) =>
                    updateEntry(i, { name: e.currentTarget.value })
                  }
                  placeholder="param name"
                  w={130}
                />
              </Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  data={[
                    { value: "fixed", label: "Fixed" },
                    { value: "range", label: "Range" },
                    { value: "choice", label: "Choice" },
                  ]}
                  value={entry.mode}
                  onChange={(v) =>
                    updateEntry(i, {
                      mode: (v as SearchSpaceMode) ?? "fixed",
                    })
                  }
                  w={90}
                />
              </Table.Td>
              <Table.Td>
                <SearchSpaceValueInputs entry={entry} index={i} onUpdate={updateEntry} />
              </Table.Td>
              <Table.Td>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="red"
                  onClick={() => removeEntry(i)}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={addEntry}
        >
          Add Parameter
        </Button>
        <Button size="xs" onClick={onSave}>
          Save Search Space
        </Button>
      </Group>
    </Stack>
  );
}

function SearchSpaceValueInputs({
  entry,
  index,
  onUpdate,
}: {
  entry: SearchSpaceEntry;
  index: number;
  onUpdate: (index: number, patch: Partial<SearchSpaceEntry>) => void;
}) {
  switch (entry.mode) {
    case "fixed":
      return (
        <TextInput
          size="xs"
          value={entry.fixedValue}
          onChange={(e) =>
            onUpdate(index, { fixedValue: e.currentTarget.value })
          }
          placeholder="value"
          w={120}
        />
      );
    case "range":
      return (
        <Group gap={4} wrap="nowrap">
          <NumberInput
            size="xs"
            value={entry.rangeMin ? Number(entry.rangeMin) : ""}
            onChange={(v) => onUpdate(index, { rangeMin: String(v) })}
            placeholder="min"
            w={60}
            allowDecimal
          />
          <NumberInput
            size="xs"
            value={entry.rangeMax ? Number(entry.rangeMax) : ""}
            onChange={(v) => onUpdate(index, { rangeMax: String(v) })}
            placeholder="max"
            w={60}
            allowDecimal
          />
          <NumberInput
            size="xs"
            value={entry.rangeStep ? Number(entry.rangeStep) : ""}
            onChange={(v) => onUpdate(index, { rangeStep: String(v) })}
            placeholder="step"
            w={60}
            allowDecimal
          />
          <Select
            size="xs"
            data={[
              { value: "uniform", label: "Uniform" },
              { value: "log-uniform", label: "Log" },
            ]}
            value={entry.distribution}
            onChange={(v) =>
              onUpdate(index, { distribution: (v as "uniform" | "log-uniform") ?? "uniform" })
            }
            w={75}
          />
        </Group>
      );
    case "choice":
      return (
        <TextInput
          size="xs"
          value={entry.choiceValues}
          onChange={(e) =>
            onUpdate(index, { choiceValues: e.currentTarget.value })
          }
          placeholder="val1, val2, val3"
          w={180}
        />
      );
  }
}

function parseNumericOrString(val: string): unknown {
  if (val.trim() === "") return "";
  const num = Number(val);
  return isNaN(num) ? val.trim() : num;
}

// --- Calibration Section (12.2) ---

function CalibrationSection({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  const dataSection = (config as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
  const task = dataSection?.task;
  const calibration = config.calibration as
    | { method?: string }
    | null
    | undefined;
  const enabled = calibration != null;
  const method = calibration?.method ?? "isotonic";

  const onToggle = useCallback(
    (checked: boolean) => {
      const next = structuredClone(config);
      next.calibration = checked ? { method: "isotonic" } : null;
      onUpdate(next);
    },
    [config, onUpdate],
  );

  const onMethodChange = useCallback(
    (value: string | null) => {
      if (!value) return;
      const next = structuredClone(config);
      next.calibration = { method: value };
      onUpdate(next);
    },
    [config, onUpdate],
  );

  // Only show for binary classification
  if (task !== "binary") return null;

  return (
    <Accordion>
      <Accordion.Item value="calibration">
        <Accordion.Control>Calibration</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <Switch
              label="Enable calibration"
              checked={enabled}
              onChange={(e) => onToggle(e.currentTarget.checked)}
            />
            {enabled && (
              <Select
                label="Method"
                data={[
                  { value: "isotonic", label: "Isotonic" },
                  { value: "sigmoid", label: "Sigmoid" },
                ]}
                value={method}
                onChange={onMethodChange}
              />
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

function RawConfigToggle({
  config,
}: {
  config: Record<string, unknown>;
}) {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Button size="xs" variant="subtle" onClick={open}>
        Raw Config
      </Button>
      <Modal opened={opened} onClose={close} title="Raw Config" size="lg">
        <Code block style={{ maxHeight: 500, overflow: "auto" }}>
          {toYaml(config)}
        </Code>
      </Modal>
    </>
  );
}

/**
 * Check if tuning config has at least one Range or Choice parameter.
 */
function hasRangeOrChoice(config: Record<string, unknown>): boolean {
  const tuning = config.tuning as Record<string, unknown> | undefined;
  if (!tuning) return false;
  const space = tuning.search_space as Record<string, unknown> | undefined;
  if (!space) return false;
  return Object.values(space).some((v) => {
    if (Array.isArray(v)) return true; // Choice
    if (v && typeof v === "object" && "low" in v && "high" in v) return true; // Range
    return false;
  });
}
