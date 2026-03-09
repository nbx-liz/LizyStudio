import { useState, useCallback, useMemo } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck,
  IconDownload,
  IconUpload,
  IconPlayerPlay,
} from "@tabler/icons-react";

import { type JobSummary, fetchJobs, fetchJobPlots } from "../api/jobs";
import {
  type InferenceRecord,
  runInference,
  uploadAndRunInference,
  fetchInferenceHistory,
  fetchInferencePredictions,
  fetchInferenceMetrics,
  fetchInferencePlot,
  inferenceDownloadUrl,
  fetchInferenceComparison,
} from "../api/inference";
import { PlotlyChart } from "../components/PlotlyChart";

export function InferencePage() {
  const queryClient = useQueryClient();

  // Setup state
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dataPath, setDataPath] = useState("");
  const [returnShap, setReturnShap] = useState(false);
  const [running, setRunning] = useState(false);

  // Selected inference result
  const [selectedInfId, setSelectedInfId] = useState<string | null>(null);

  // Fetch completed jobs for selector
  const jobsQuery = useQuery({
    queryKey: ["jobs", "completed"],
    queryFn: () => fetchJobs("completed"),
  });

  const completedJobs = jobsQuery.data ?? [];

  // Fetch inference history for selected job
  const historyQuery = useQuery({
    queryKey: ["inference-history", selectedJobId],
    queryFn: () => fetchInferenceHistory(selectedJobId!),
    enabled: !!selectedJobId,
  });

  const history = useMemo(
    () => historyQuery.data ?? [],
    [historyQuery.data],
  );

  // Auto-select latest inference
  const effectiveInfId = useMemo(() => {
    if (selectedInfId && history.some((h) => h.inf_id === selectedInfId)) {
      return selectedInfId;
    }
    return history.length > 0 ? history[0].inf_id : null;
  }, [selectedInfId, history]);

  // Run inference from path
  const onRunPath = useCallback(async () => {
    if (!selectedJobId || !dataPath) return;
    setRunning(true);
    try {
      const res = await runInference(selectedJobId, dataPath, returnShap);
      setSelectedInfId(res.inf_id);
      queryClient.invalidateQueries({
        queryKey: ["inference-history", selectedJobId],
      });
      notifications.show({
        title: "Inference complete",
        message: `${res.inf_id}`,
        color: "green",
      });
    } catch (e) {
      notifications.show({
        title: "Inference failed",
        message: String(e),
        color: "red",
      });
    } finally {
      setRunning(false);
    }
  }, [selectedJobId, dataPath, returnShap, queryClient]);

  // Run inference from upload
  const onDropFiles = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file || !selectedJobId) return;
      setRunning(true);
      try {
        const res = await uploadAndRunInference(file, selectedJobId, returnShap);
        setSelectedInfId(res.inf_id);
        queryClient.invalidateQueries({
          queryKey: ["inference-history", selectedJobId],
        });
        notifications.show({
          title: "Inference complete",
          message: `${res.inf_id}`,
          color: "green",
        });
      } catch (e) {
        notifications.show({
          title: "Inference failed",
          message: String(e),
          color: "red",
        });
      } finally {
        setRunning(false);
      }
    },
    [selectedJobId, returnShap, queryClient],
  );

  // Job select data
  const jobSelectData = completedJobs.map((j: JobSummary) => ({
    value: j.job_id,
    label: `${j.job_id} (${j.job_type})`,
  }));

  return (
    <Box style={{ display: "flex", gap: 16, height: "calc(100vh - 80px)" }}>
      {/* Left Panel — Setup + History */}
      <Paper
        withBorder
        p="sm"
        style={{
          width: 360,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Stack gap="sm" mb="sm">
          <Title order={4}>Inference</Title>

          {/* Model select */}
          <Select
            label="Model (Job)"
            placeholder="Select a completed job"
            data={jobSelectData}
            value={selectedJobId}
            onChange={setSelectedJobId}
            size="xs"
            searchable
          />

          {/* Data source — path */}
          <TextInput
            label="Data Path"
            placeholder="/path/to/data.csv"
            value={dataPath}
            onChange={(e) => setDataPath(e.currentTarget.value)}
            size="xs"
          />

          {/* Data source — upload */}
          <Dropzone
            onDrop={onDropFiles}
            accept={{
              "text/csv": [".csv"],
              "application/octet-stream": [".parquet"],
            }}
            maxSize={100 * 1024 * 1024}
            disabled={!selectedJobId || running}
            p="xs"
          >
            <Group justify="center" gap="xs">
              <IconUpload size={16} />
              <Text size="xs" c="dimmed">
                Drop CSV/Parquet or click
              </Text>
            </Group>
          </Dropzone>

          {/* Options */}
          <Checkbox
            label="Return SHAP values"
            checked={returnShap}
            onChange={(e) => setReturnShap(e.currentTarget.checked)}
            size="xs"
          />

          {/* Run button */}
          <Button
            leftSection={<IconPlayerPlay size={14} />}
            onClick={onRunPath}
            loading={running}
            disabled={!selectedJobId || !dataPath}
            fullWidth
          >
            Run
          </Button>
        </Stack>

        {/* Inference History */}
        {history.length > 0 && (
          <>
            <Text fw={600} size="sm" mb={4}>
              History
            </Text>
            <ScrollArea style={{ flex: 1 }}>
              <Stack gap={4}>
                {history.map((rec) => (
                  <HistoryRow
                    key={rec.inf_id}
                    record={rec}
                    selected={rec.inf_id === effectiveInfId}
                    onClick={() => setSelectedInfId(rec.inf_id)}
                  />
                ))}
              </Stack>
            </ScrollArea>
          </>
        )}
      </Paper>

      {/* Right Panel — Results */}
      <Paper withBorder p="md" style={{ flex: 1, overflow: "auto" }}>
        {effectiveInfId && selectedJobId ? (
          <InferenceResults
            infId={effectiveInfId}
            jobId={selectedJobId}
            history={history}
          />
        ) : (
          <Stack align="center" justify="center" h="100%">
            <Text c="dimmed">
              Select a model and run inference to see results
            </Text>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}

// --- History Row ---

function HistoryRow({
  record,
  selected,
  onClick,
}: {
  record: InferenceRecord;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      p="xs"
      style={{
        borderRadius: 6,
        border: selected
          ? "1px solid var(--mantine-color-blue-4)"
          : "1px solid transparent",
        backgroundColor: selected
          ? "var(--mantine-color-blue-0)"
          : undefined,
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <Text size="xs" fw={500} truncate style={{ flex: 1 }}>
          {record.inf_id}
        </Text>
        <Badge size="xs" variant="light">
          {record.row_count} rows
        </Badge>
        {record.has_ground_truth && (
          <Badge size="xs" variant="light" color="green">
            GT
          </Badge>
        )}
      </Group>
    </UnstyledButton>
  );
}

// --- Inference Results ---

function InferenceResults({
  infId,
  jobId,
  history,
}: {
  infId: string;
  jobId: string;
  history: InferenceRecord[];
}) {
  const record = history.find((h) => h.inf_id === infId);
  const hasGT = record?.has_ground_truth ?? false;

  return (
    <Stack gap="md">
      {/* Header */}
      <Group gap="xs">
        <Title order={4}>{infId}</Title>
        <Badge variant="light">{jobId}</Badge>
        <Badge variant="light">{record?.row_count ?? "?"} rows</Badge>
        {hasGT ? (
          <Badge color="green" leftSection={<IconCheck size={12} />}>
            Ground Truth
          </Badge>
        ) : (
          <Badge color="gray">Prediction Only</Badge>
        )}
      </Group>

      {/* Warnings */}
      {record && record.warnings.length > 0 && (
        <Alert color="yellow" title="Warnings">
          {record.warnings.map((w, i) => (
            <Text key={i} size="xs">
              {w}
            </Text>
          ))}
        </Alert>
      )}

      {/* Metrics (ground truth only) */}
      {hasGT && <InferenceMetricsSection infId={infId} jobId={jobId} />}

      {/* Plots */}
      <InferencePlotSection infId={infId} jobId={jobId} />

      {/* Predictions table */}
      <Accordion defaultValue="predictions">
        <Accordion.Item value="predictions">
          <Accordion.Control>Predictions</Accordion.Control>
          <Accordion.Panel>
            <PredictionsTable infId={infId} jobId={jobId} />
          </Accordion.Panel>
        </Accordion.Item>

        {/* Comparison (no GT only) */}
        {!hasGT && history.length > 1 && (
          <Accordion.Item value="comparison">
            <Accordion.Control>Comparison</Accordion.Control>
            <Accordion.Panel>
              <ComparisonSection
                infId={infId}
                jobId={jobId}
                history={history}
              />
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>

      {/* Download */}
      <Button
        size="xs"
        variant="light"
        leftSection={<IconDownload size={14} />}
        component="a"
        href={inferenceDownloadUrl(infId, jobId)}
        download={`inference_${infId}_${jobId}.csv`}
      >
        Download CSV
      </Button>
    </Stack>
  );
}

// --- Sub-components ---

function InferenceMetricsSection({
  infId,
  jobId,
}: {
  infId: string;
  jobId: string;
}) {
  const metricsQuery = useQuery({
    queryKey: ["inference-metrics", infId, jobId],
    queryFn: () => fetchInferenceMetrics(infId, jobId),
  });

  const metrics = metricsQuery.data;
  if (!metrics || "error" in metrics) return null;

  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Inference Metrics
      </Text>
      <Table fz="xs" withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Metric</Table.Th>
            <Table.Th>Value</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map(([key, val]) => (
            <Table.Tr key={key}>
              <Table.Td>{key}</Table.Td>
              <Table.Td>
                {typeof val === "number" ? val.toFixed(4) : String(val)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function InferencePlotSection({
  infId,
  jobId,
}: {
  infId: string;
  jobId: string;
}) {
  const [plotType, setPlotType] = useState<string | null>(null);

  // Use the model's available plots (from the job)
  const plotsQuery = useQuery({
    queryKey: ["job-plots-for-inf", jobId],
    queryFn: () => fetchJobPlots(jobId),
  });

  const plotQuery = useQuery({
    queryKey: ["inference-plot", infId, jobId, plotType],
    queryFn: () => fetchInferencePlot(infId, jobId, plotType!),
    enabled: !!plotType,
  });

  const availablePlots = plotsQuery.data ?? [];
  if (availablePlots.length === 0) return null;

  return (
    <Stack gap="xs">
      <Group>
        <Text fw={600} size="sm">
          Plots
        </Text>
        <Select
          size="xs"
          data={availablePlots}
          value={plotType}
          onChange={setPlotType}
          placeholder="Select plot"
          w={200}
        />
      </Group>
      {plotQuery.data && <PlotlyChart json={plotQuery.data.plotly_json} />}
    </Stack>
  );
}

function PredictionsTable({
  infId,
  jobId,
}: {
  infId: string;
  jobId: string;
}) {
  const [page, setPage] = useState(1);
  const rows = 50;
  const offset = (page - 1) * rows;

  const predQuery = useQuery({
    queryKey: ["inference-predictions", infId, jobId, page],
    queryFn: () => fetchInferencePredictions(infId, jobId, rows, offset),
  });

  if (predQuery.isLoading) return <Loader size="sm" />;
  if (!predQuery.data) return null;

  const { columns, data, total_rows } = predQuery.data;
  const totalPages = Math.ceil(total_rows / rows);

  return (
    <Stack gap="xs">
      <Table fz="xs" withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            {columns.map((c) => (
              <Table.Th key={c}>{c}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.map((row, i) => (
            <Table.Tr key={i}>
              {columns.map((c) => (
                <Table.Td key={c}>{formatCell(row[c])}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {totalPages > 1 && (
        <Group justify="center">
          <Pagination
            size="xs"
            total={totalPages}
            value={page}
            onChange={setPage}
          />
          <Text size="xs" c="dimmed">
            {total_rows} total rows
          </Text>
        </Group>
      )}
    </Stack>
  );
}

function ComparisonSection({
  infId,
  jobId,
  history,
}: {
  infId: string;
  jobId: string;
  history: InferenceRecord[];
}) {
  const others = history.filter((h) => h.inf_id !== infId);
  const [otherInfId, setOtherInfId] = useState<string | null>(
    others.length > 0 ? others[0].inf_id : null,
  );

  const compQuery = useQuery({
    queryKey: ["inference-comparison", infId, otherInfId, jobId],
    queryFn: () => fetchInferenceComparison(infId, otherInfId!, jobId),
    enabled: !!otherInfId,
  });

  if (others.length === 0)
    return <Text size="sm" c="dimmed">No other inferences to compare.</Text>;

  const compData = compQuery.data as
    | {
        current?: Record<string, number>;
        other?: Record<string, number>;
      }
    | undefined;

  return (
    <Stack gap="xs">
      <Select
        size="xs"
        label="Compare with"
        data={others.map((h) => ({
          value: h.inf_id,
          label: `${h.inf_id} (${h.row_count} rows)`,
        }))}
        value={otherInfId}
        onChange={setOtherInfId}
        w={250}
      />
      {compData?.current && compData?.other && (
        <Table fz="xs" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Stat</Table.Th>
              <Table.Th>Current</Table.Th>
              <Table.Th>Other</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.keys(compData.current).map((key) => (
              <Table.Tr key={key}>
                <Table.Td>{key}</Table.Td>
                <Table.Td>{compData.current![key].toFixed(4)}</Table.Td>
                <Table.Td>{compData.other![key].toFixed(4)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") return Number.isInteger(val) ? String(val) : val.toFixed(4);
  return String(val);
}
