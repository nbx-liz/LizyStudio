import { useState, useCallback, useMemo } from "react";
import {
  Accordion,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Pagination,
  Paper,
  ScrollArea,
  SegmentedControl,
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
  const [sourceType, setSourceType] = useState<string>("path");
  const [dataPath, setDataPath] = useState("");
  const [returnShap, setReturnShap] = useState(false);
  const [evaluate, setEvaluate] = useState(true);
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

  // Derive the selected record for GT detection display
  const selectedRecord = useMemo(
    () => history.find((h) => h.inf_id === effectiveInfId) ?? null,
    [history, effectiveInfId],
  );

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

          {/* Data source selector */}
          <SegmentedControl
            size="xs"
            data={[
              { value: "path", label: "Path" },
              { value: "upload", label: "Upload" },
            ]}
            value={sourceType}
            onChange={setSourceType}
          />

          {/* Data source — path */}
          {sourceType === "path" && (
            <TextInput
              label="Data Path"
              placeholder="/path/to/data.csv"
              value={dataPath}
              onChange={(e) => setDataPath(e.currentTarget.value)}
              size="xs"
            />
          )}

          {/* Data source — upload */}
          {sourceType === "upload" && (
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
          )}

          {/* GT detection message */}
          {effectiveInfId && selectedRecord && (
            selectedRecord.has_ground_truth ? (
              <Text size="xs" c="green">
                Target detected
              </Text>
            ) : (
              <Text size="xs" c="dimmed">
                Target column not found in data
              </Text>
            )
          )}

          {/* Options */}
          <Checkbox
            label="Return SHAP values"
            checked={returnShap}
            onChange={(e) => setReturnShap(e.currentTarget.checked)}
            size="xs"
          />
          <Checkbox
            label="Evaluate"
            checked={evaluate}
            onChange={(e) => setEvaluate(e.currentTarget.checked)}
            size="xs"
          />

          {/* Run button */}
          <Button
            leftSection={<IconPlayerPlay size={14} />}
            onClick={onRunPath}
            loading={running}
            disabled={
              !selectedJobId ||
              (sourceType === "path" && !dataPath)
            }
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

      {/* GT-based display branching */}
      {hasGT ? (
        <GTResultsView
          infId={infId}
          jobId={jobId}
          record={record}
        />
      ) : (
        <NoGTResultsView
          infId={infId}
          jobId={jobId}
          record={record}
          history={history}
        />
      )}

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

// --- GT present: score table + plots + accordion (predictions, warnings) ---

function GTResultsView({
  infId,
  jobId,
  record,
}: {
  infId: string;
  jobId: string;
  record: InferenceRecord | undefined;
}) {
  return (
    <>
      {/* Score table (IS / OOS / Inf) */}
      <InferenceMetricsSection infId={infId} jobId={jobId} />

      {/* Evaluation plots */}
      <InferencePlotSection infId={infId} jobId={jobId} />

      {/* Accordion: Predictions + Warnings */}
      <Accordion defaultValue="predictions">
        <Accordion.Item value="predictions">
          <Accordion.Control>Predictions</Accordion.Control>
          <Accordion.Panel>
            <PredictionsTable infId={infId} jobId={jobId} />
          </Accordion.Panel>
        </Accordion.Item>

        {record && record.warnings.length > 0 && (
          <Accordion.Item value="warnings">
            <Accordion.Control>
              Warnings ({record.warnings.length})
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap={4}>
                {record.warnings.map((w, i) => (
                  <Text key={i} size="xs" c="yellow">
                    {w}
                  </Text>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>
    </>
  );
}

// --- No GT: predictions table + distribution + comparison + accordion (warnings) ---

function NoGTResultsView({
  infId,
  jobId,
  record,
  history,
}: {
  infId: string;
  jobId: string;
  record: InferenceRecord | undefined;
  history: InferenceRecord[];
}) {
  return (
    <>
      {/* Predictions table at top level */}
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Predictions
        </Text>
        <PredictionsTable infId={infId} jobId={jobId} />
      </Stack>

      {/* Prediction distribution summary */}
      <PredictionDistribution infId={infId} jobId={jobId} />

      {/* Comparison section (prominent, not in accordion) */}
      {history.length > 1 && (
        <Stack gap="xs">
          <Text fw={600} size="sm">
            Comparison
          </Text>
          <ComparisonSection
            infId={infId}
            jobId={jobId}
            history={history}
          />
        </Stack>
      )}

      {/* Accordion: Warnings only */}
      {record && record.warnings.length > 0 && (
        <Accordion>
          <Accordion.Item value="warnings">
            <Accordion.Control>
              Warnings ({record.warnings.length})
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap={4}>
                {record.warnings.map((w, i) => (
                  <Text key={i} size="xs" c="yellow">
                    {w}
                  </Text>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </>
  );
}

// --- Prediction Distribution (no-GT summary stats) ---

function PredictionDistribution({
  infId,
  jobId,
}: {
  infId: string;
  jobId: string;
}) {
  const predQuery = useQuery({
    queryKey: ["inference-predictions", infId, jobId, 1],
    queryFn: () => fetchInferencePredictions(infId, jobId, 50, 0),
  });

  if (!predQuery.data) return null;

  const { data, total_rows, columns } = predQuery.data;

  // Find prediction column (commonly "prediction" or last column)
  const predCol =
    columns.find((c) => c.toLowerCase().includes("prediction")) ??
    columns[columns.length - 1];
  if (!predCol) return null;

  const numericVals = data
    .map((row) => row[predCol])
    .filter((v): v is number => typeof v === "number");

  if (numericVals.length === 0) return null;

  const mean = numericVals.reduce((a, b) => a + b, 0) / numericVals.length;
  const variance =
    numericVals.reduce((a, b) => a + (b - mean) ** 2, 0) / numericVals.length;
  const std = Math.sqrt(variance);

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Prediction Distribution
      </Text>
      <Text size="xs" c="dimmed">
        {total_rows} rows, mean={mean.toFixed(4)}, std={std.toFixed(4)}
      </Text>
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

  // Check if metrics have the split format: { inf: {...}, is: {...}, oos: {...} }
  const hasSplitFormat =
    metrics.inf &&
    typeof metrics.inf === "object" &&
    !Array.isArray(metrics.inf);

  if (hasSplitFormat) {
    const infMetrics = metrics.inf as Record<string, number>;
    const isMetrics = (metrics.is ?? {}) as Record<string, number>;
    const oosMetrics = (metrics.oos ?? {}) as Record<string, number>;

    // Collect all metric names across all splits
    const allKeys = [
      ...new Set([
        ...Object.keys(infMetrics),
        ...Object.keys(isMetrics),
        ...Object.keys(oosMetrics),
      ]),
    ];
    if (allKeys.length === 0) return null;

    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Score Table
        </Text>
        <Table fz="xs" withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Metric</Table.Th>
              <Table.Th>IS</Table.Th>
              <Table.Th>OOS</Table.Th>
              <Table.Th>Inf</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allKeys.map((key) => (
              <Table.Tr key={key}>
                <Table.Td>{key}</Table.Td>
                <Table.Td>{formatMetricValue(isMetrics[key])}</Table.Td>
                <Table.Td>{formatMetricValue(oosMetrics[key])}</Table.Td>
                <Table.Td>{formatMetricValue(infMetrics[key])}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    );
  }

  // Fallback: flat metrics (legacy format)
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
    return (
      <Text size="sm" c="dimmed">
        No other inferences to compare.
      </Text>
    );

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
        w={280}
      />
      {compQuery.isLoading && <Loader size="sm" />}
      {compData?.current && compData?.other && (
        <Table fz="xs" withTableBorder striped>
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
                <Table.Td>
                  {formatCompStat(key, compData.current![key])}
                </Table.Td>
                <Table.Td>
                  {formatCompStat(key, compData.other![key])}
                </Table.Td>
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
  if (typeof val === "number")
    return Number.isInteger(val) ? String(val) : val.toFixed(4);
  return String(val);
}

/** Format a metric value for the score table */
function formatMetricValue(val: unknown): string {
  if (val === null || val === undefined) return "-";
  if (typeof val === "number") return val.toFixed(4);
  return String(val);
}

// Keys that represent percentages in comparison stats
const PERCENTAGE_KEYS = new Set(["positive_pct", "negative_pct", "pct"]);

/** Format comparison stat values — percentages with 1 decimal, others with 4 */
function formatCompStat(key: string, val: number): string {
  if (val === null || val === undefined) return "-";
  if (PERCENTAGE_KEYS.has(key) || key.endsWith("_pct")) {
    return `${val.toFixed(1)}%`;
  }
  return val.toFixed(4);
}
