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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

  // Handlers
  const onLoadPath = useCallback(async () => {
    if (!pathInput.trim()) return;
    setLoading(true);
    try {
      const res = await loadDataFromPath(pathInput.trim());
      setDataRef(res.data_ref);
      setTarget(null);
      setTask(null);
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
      if (value && previewQuery.data) {
        setTask(autoDetectTask(value, previewQuery.data.data));
      }
    },
    [previewQuery.data],
  );

  // Column names for target dropdown
  const allColumns = previewQuery.data?.columns ?? [];

  // Feature summary computation
  const featureSummary = computeFeatureSummary(columnsQuery.data ?? null);

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
              <ColumnSettingsTable columns={columnsQuery.data.columns} />
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
                defaultValue={task === "regression" ? "KFold" : "StratifiedKFold"}
                disabled={!target}
              />
              <NumberInput label="Folds" defaultValue={5} min={2} max={20} disabled={!target} />
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

function ColumnSettingsTable({ columns }: { columns: ColumnInfo[] }) {
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
        {columns.map((col) => (
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
              <Checkbox size="xs" defaultChecked={col.suggested_excluded} />
            </Table.Td>
            <Table.Td>
              {col.suggested_excluded ? (
                <Text size="xs" c="dimmed">
                  —
                </Text>
              ) : (
                <Select
                  size="xs"
                  data={["numeric", "categorical"]}
                  defaultValue={col.suggested_type}
                  w={100}
                />
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// --- Helpers ---

function autoDetectTask(
  targetCol: string,
  data: Record<string, unknown>[],
): string {
  const values = data.map((row) => row[targetCol]);
  const unique = new Set(values);
  if (unique.size === 2) return "binary";
  const allNumeric = values.every((v) => typeof v === "number");
  if (!allNumeric) return "multiclass";
  if (unique.size <= 20) return "multiclass";
  return "regression";
}

function computeFeatureSummary(response: ColumnsResponse | null) {
  if (!response) return null;
  const cols = response.columns;
  const excluded = cols.filter((c) => c.suggested_excluded);
  const included = cols.filter((c) => !c.suggested_excluded);
  return {
    total: included.length,
    numeric: included.filter((c) => c.suggested_type === "numeric").length,
    categorical: included.filter((c) => c.suggested_type === "categorical").length,
    excluded: excluded.length,
    idCount: excluded.filter((c) => c.exclude_reason === "id").length,
    constCount: excluded.filter((c) => c.exclude_reason === "constant").length,
    manualCount: excluded.filter((c) => c.exclude_reason === null).length,
  };
}
