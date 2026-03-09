import { useState, useCallback } from "react";
import {
  Accordion,
  Badge,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Radio,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Button,
  Alert,
} from "@mantine/core";
import { Dropzone, MIME_TYPES } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IconUpload, IconFile, IconX, IconInfoCircle } from "@tabler/icons-react";

import {
  type ColumnInfo,
  type ColumnsResponse,
  type DataRef,
  fetchColumns,
  fetchPreview,
  loadDataFromPath,
  uploadData,
} from "../api/workspace";
import { updateConfig as updateConfigApi } from "../api/config";

// Override state for a single column
interface ColumnOverride {
  excluded?: boolean;
  type?: string;
}

type SourceType = "path" | "upload";

export function DataPanel() {
  const queryClient = useQueryClient();

  // Data source state
  const [sourceType, setSourceType] = useState<SourceType>("path");
  const [pathInput, setPathInput] = useState("");
  const [dataRef, setDataRef] = useState<DataRef | null>(null);
  const [loading, setLoading] = useState(false);

  // Target / Task
  const [target, setTarget] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);

  // CV state (controlled)
  const [cvStrategy, setCvStrategy] = useState<string>("StratifiedKFold");
  const [cvFolds, setCvFolds] = useState<number>(5);
  const [groupCol, setGroupCol] = useState<string | null>(null);

  // Column overrides (controlled state for column settings)
  const [columnOverrides, setColumnOverrides] = useState<
    Record<string, ColumnOverride>
  >({});

  // Queries (only enabled when data is loaded)
  const previewQuery = useQuery({
    queryKey: ["data-preview", dataRef?.fingerprint],
    queryFn: () => fetchPreview(10),
    enabled: !!dataRef,
  });

  const columnsQuery = useQuery({
    queryKey: ["data-columns", dataRef?.fingerprint, target],
    queryFn: () => fetchColumns(target ?? undefined),
    enabled: !!dataRef,
  });

  // Mutation for updating backend config
  const updateConfigMutation = useMutation({
    mutationFn: updateConfigApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (e) => {
      notifications.show({
        title: "Config sync failed",
        message: String(e),
        color: "red",
      });
    },
  });

  // Build and push config update helper
  const syncConfigFromState = useCallback(
    (overrides?: {
      targetOverride?: string | null;
      taskOverride?: string | null;
      cvStrategyOverride?: string;
      cvFoldsOverride?: number;
      groupColOverride?: string | null;
      columnOverridesMap?: Record<string, ColumnOverride>;
    }) => {
      const t = overrides?.targetOverride !== undefined ? overrides.targetOverride : target;
      const tk = overrides?.taskOverride !== undefined ? overrides.taskOverride : task;
      const strat = overrides?.cvStrategyOverride ?? cvStrategy;
      const folds = overrides?.cvFoldsOverride ?? cvFolds;
      const gc = overrides?.groupColOverride !== undefined ? overrides.groupColOverride : groupCol;
      const colOvr = overrides?.columnOverridesMap ?? columnOverrides;

      const configPatch: Record<string, unknown> = {};
      if (t) configPatch.target = t;
      if (tk) configPatch.task = tk;

      // CV config
      const cvConfig: Record<string, unknown> = {
        strategy: strat,
        n_splits: folds,
      };
      if (strat === "GroupKFold" && gc) {
        cvConfig.group_col = gc;
      }
      configPatch.cv = cvConfig;

      // Column exclusions and type overrides
      const excludedCols: string[] = [];
      const featureTypes: Record<string, string> = {};
      for (const [colName, ovr] of Object.entries(colOvr)) {
        if (ovr.excluded) {
          excludedCols.push(colName);
        }
        if (ovr.type) {
          featureTypes[colName] = ovr.type;
        }
      }
      if (excludedCols.length > 0) {
        configPatch.exclude_columns = excludedCols;
      }
      if (Object.keys(featureTypes).length > 0) {
        configPatch.feature_types = featureTypes;
      }

      updateConfigMutation.mutate(configPatch);
    },
    [target, task, cvStrategy, cvFolds, groupCol, columnOverrides, updateConfigMutation],
  );

  // Handlers
  const onLoadPath = useCallback(async () => {
    if (!pathInput.trim()) return;
    setLoading(true);
    try {
      const res = await loadDataFromPath(pathInput.trim());
      setDataRef(res.data_ref);
      setTarget(null);
      setTask(null);
      setColumnOverrides({});
      queryClient.invalidateQueries({ queryKey: ["data-preview"] });
      queryClient.invalidateQueries({ queryKey: ["data-columns"] });
    } catch (e) {
      notifications.show({
        title: "Load failed",
        message: String(e),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }, [pathInput, queryClient]);

  const onUpload = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setLoading(true);
      try {
        const res = await uploadData(file);
        setDataRef(res.data_ref);
        setTarget(null);
        setTask(null);
        setColumnOverrides({});
        queryClient.invalidateQueries({ queryKey: ["data-preview"] });
        queryClient.invalidateQueries({ queryKey: ["data-columns"] });
      } catch (e) {
        notifications.show({
          title: "Upload failed",
          message: String(e),
          color: "red",
        });
      } finally {
        setLoading(false);
      }
    },
    [queryClient],
  );

  const onTargetChange = useCallback(
    (value: string | null) => {
      setTarget(value);
      // Use API-detected task from columns response when available
      const detectedTask =
        value && columnsQuery.data
          ? guessTaskFromColumns(columnsQuery.data)
          : null;
      setTask(detectedTask);
      // Default CV strategy based on task
      const defaultStrategy =
        detectedTask === "regression" ? "KFold" : "StratifiedKFold";
      setCvStrategy(defaultStrategy);
      syncConfigFromState({
        targetOverride: value,
        taskOverride: detectedTask,
        cvStrategyOverride: defaultStrategy,
      });
    },
    [columnsQuery.data, syncConfigFromState],
  );

  const onColumnOverrideChange = useCallback(
    (colName: string, patch: Partial<ColumnOverride>) => {
      setColumnOverrides((prev) => {
        const next = { ...prev, [colName]: { ...prev[colName], ...patch } };
        // Sync to backend
        syncConfigFromState({ columnOverridesMap: next });
        return next;
      });
    },
    [syncConfigFromState],
  );

  const onCvStrategyChange = useCallback(
    (value: string | null) => {
      const v = value ?? "StratifiedKFold";
      setCvStrategy(v);
      if (v !== "GroupKFold") setGroupCol(null);
      syncConfigFromState({
        cvStrategyOverride: v,
        groupColOverride: v !== "GroupKFold" ? null : groupCol,
      });
    },
    [groupCol, syncConfigFromState],
  );

  const onCvFoldsChange = useCallback(
    (value: number | string) => {
      const n = typeof value === "number" ? value : 5;
      setCvFolds(n);
      syncConfigFromState({ cvFoldsOverride: n });
    },
    [syncConfigFromState],
  );

  const onGroupColChange = useCallback(
    (value: string | null) => {
      setGroupCol(value);
      syncConfigFromState({ groupColOverride: value });
    },
    [syncConfigFromState],
  );

  // Column names for target dropdown
  const allColumns = previewQuery.data?.columns ?? [];

  // Non-excluded columns for GroupKFold group column selector
  const availableGroupColumns =
    columnsQuery.data?.columns
      .filter((c) => {
        const ovr = columnOverrides[c.name];
        const excluded = ovr?.excluded ?? c.suggested_excluded;
        return !excluded;
      })
      .map((c) => c.name) ?? [];

  // Feature summary computation
  const featureSummary = computeFeatureSummary(columnsQuery.data ?? null, columnOverrides);

  return (
    <Paper p="md" withBorder>
      <Title order={5} mb="sm">
        Data
      </Title>
      <Accordion multiple defaultValue={["data-source"]}>
        {/* --- Data Source --- */}
        <Accordion.Item value="data-source">
          <Accordion.Control>Data Source</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Radio.Group value={sourceType} onChange={(v) => setSourceType(v as SourceType)}>
                <Group>
                  <Radio value="path" label="Path" />
                  <Radio value="upload" label="Upload" />
                </Group>
              </Radio.Group>

              {sourceType === "path" ? (
                <Group gap="xs" align="end">
                  <TextInput
                    placeholder="/data/train.csv"
                    value={pathInput}
                    onChange={(e) => setPathInput(e.currentTarget.value)}
                    style={{ flex: 1 }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onLoadPath();
                    }}
                  />
                  <Button size="sm" loading={loading} onClick={onLoadPath}>
                    Load
                  </Button>
                </Group>
              ) : (
                <Dropzone
                  onDrop={onUpload}
                  accept={[MIME_TYPES.csv, "application/vnd.apache.parquet" as string]}
                  maxSize={500 * 1024 * 1024}
                  loading={loading}
                >
                  <Group justify="center" gap="xl" style={{ minHeight: 80, pointerEvents: "none" }}>
                    <Dropzone.Accept>
                      <IconUpload size={32} />
                    </Dropzone.Accept>
                    <Dropzone.Reject>
                      <IconX size={32} />
                    </Dropzone.Reject>
                    <Dropzone.Idle>
                      <IconFile size={32} />
                    </Dropzone.Idle>
                    <Text size="sm" c="dimmed">
                      Drop CSV / Parquet here
                    </Text>
                  </Group>
                </Dropzone>
              )}

              {dataRef && (
                <Text size="sm" c="dimmed">
                  {dataRef.filename} — {dataRef.shape[0]} rows × {dataRef.shape[1]} cols
                </Text>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* --- Target / Task --- */}
        <Accordion.Item value="target-task">
          <Accordion.Control>Target / Task</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Select
                label="Target"
                placeholder="Select target column"
                data={allColumns}
                value={target}
                onChange={onTargetChange}
                disabled={!dataRef}
                searchable
              />
              <Select
                label="Task"
                data={["binary", "multiclass", "regression"]}
                value={task}
                onChange={setTask}
                disabled={!target}
              />
              {task && (
                <Alert icon={<IconInfoCircle size={16} />} variant="light" color="blue" p="xs">
                  <Text size="xs">Auto-detected: {task}</Text>
                </Alert>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* --- Column Settings --- */}
        <Accordion.Item value="column-settings">
          <Accordion.Control>Column Settings</Accordion.Control>
          <Accordion.Panel>
            {columnsQuery.data ? (
              <ColumnSettingsTable
                columns={columnsQuery.data.columns}
                overrides={columnOverrides}
                onOverrideChange={onColumnOverrideChange}
              />
            ) : (
              <Text size="sm" c="dimmed">
                Load data and select a target to see column settings.
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        {/* --- Cross Validation --- */}
        <Accordion.Item value="cv">
          <Accordion.Control>Cross Validation</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Select
                label="Strategy"
                data={["KFold", "StratifiedKFold", "GroupKFold", "TimeSeriesSplit"]}
                value={cvStrategy}
                onChange={onCvStrategyChange}
                disabled={!target}
              />
              <NumberInput
                label="Folds"
                value={cvFolds}
                onChange={onCvFoldsChange}
                min={2}
                max={20}
                disabled={!target}
              />
              {cvStrategy === "GroupKFold" && (
                <Select
                  label="Group column"
                  placeholder="Select group column"
                  data={availableGroupColumns}
                  value={groupCol}
                  onChange={onGroupColChange}
                  disabled={!target}
                  searchable
                />
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* --- Feature Summary --- */}
        <Accordion.Item value="feature-summary">
          <Accordion.Control>Feature Summary</Accordion.Control>
          <Accordion.Panel>
            {featureSummary ? (
              <Stack gap={4}>
                <Text size="sm">
                  Features: {featureSummary.total} (Numeric: {featureSummary.numeric}, Categorical:{" "}
                  {featureSummary.categorical})
                </Text>
                <Text size="sm">
                  Excluded: {featureSummary.excluded} (ID: {featureSummary.idCount}, Const:{" "}
                  {featureSummary.constCount}, Manual: {featureSummary.manualCount})
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                No data loaded.
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Paper>
  );
}

// --- Sub-components ---

function ColumnSettingsTable({
  columns,
  overrides,
  onOverrideChange,
}: {
  columns: ColumnInfo[];
  overrides: Record<string, ColumnOverride>;
  onOverrideChange: (colName: string, patch: Partial<ColumnOverride>) => void;
}) {
  return (
    <Table striped highlightOnHover withTableBorder fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Column</Table.Th>
          <Table.Th>Uniq</Table.Th>
          <Table.Th>Excl</Table.Th>
          <Table.Th>Type</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {columns.map((col) => {
          const ovr = overrides[col.name];
          const excluded = ovr?.excluded ?? col.suggested_excluded;
          const colType = ovr?.type ?? col.suggested_type;
          return (
            <Table.Tr key={col.name}>
              <Table.Td>
                <Group gap={4}>
                  <Text size="xs">{col.name}</Text>
                  {col.exclude_reason === "id" && (
                    <Badge size="xs" color="orange">
                      ID
                    </Badge>
                  )}
                  {col.exclude_reason === "constant" && (
                    <Badge size="xs" color="gray">
                      Const
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>{col.unique_count}</Table.Td>
              <Table.Td>
                <Checkbox
                  size="xs"
                  checked={excluded}
                  onChange={(e) =>
                    onOverrideChange(col.name, {
                      excluded: e.currentTarget.checked,
                    })
                  }
                />
              </Table.Td>
              <Table.Td>
                {excluded ? (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                ) : (
                  <Select
                    size="xs"
                    data={["numeric", "categorical"]}
                    value={colType}
                    onChange={(v) =>
                      onOverrideChange(col.name, {
                        type: v ?? col.suggested_type,
                      })
                    }
                    w={100}
                  />
                )}
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

// --- Helpers ---

/**
 * Guess task type from the columns response.
 * Uses target column metadata from the API rather than raw data.
 */
function guessTaskFromColumns(response: ColumnsResponse): string | null {
  if (!response.target) return null;
  const targetCol = response.columns.find((c) => c.name === response.target);
  if (!targetCol) return null;
  if (targetCol.unique_count === 2) return "binary";
  if (targetCol.suggested_type === "categorical" || targetCol.unique_count <= 20)
    return "multiclass";
  return "regression";
}

function computeFeatureSummary(
  response: ColumnsResponse | null,
  overrides: Record<string, ColumnOverride> = {},
) {
  if (!response) return null;
  const cols = response.columns;
  const excluded = cols.filter((c) => {
    const ovr = overrides[c.name];
    return ovr?.excluded ?? c.suggested_excluded;
  });
  const included = cols.filter((c) => {
    const ovr = overrides[c.name];
    return !(ovr?.excluded ?? c.suggested_excluded);
  });
  return {
    total: included.length,
    numeric: included.filter((c) => {
      const ovr = overrides[c.name];
      return (ovr?.type ?? c.suggested_type) === "numeric";
    }).length,
    categorical: included.filter((c) => {
      const ovr = overrides[c.name];
      return (ovr?.type ?? c.suggested_type) === "categorical";
    }).length,
    excluded: excluded.length,
    idCount: excluded.filter((c) => c.exclude_reason === "id").length,
    constCount: excluded.filter((c) => c.exclude_reason === "constant").length,
    manualCount: excluded.filter((c) => {
      const ovr = overrides[c.name];
      // Manually excluded = override says excluded but API didn't suggest it
      return (ovr?.excluded && !c.suggested_excluded) || c.exclude_reason === null;
    }).length,
  };
}
