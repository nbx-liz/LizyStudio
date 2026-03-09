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
  Tooltip,
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

import { useLocation } from "react-router-dom";
import {
  type JobSummary,
  fetchJobs,
  fetchJobConfig,
  fetchJobPlots,
} from "../api/jobs";
import {
  type InferenceRecord,
  runInference,
  uploadInferenceData,
  fetchInferenceHistory,
  fetchInferencePredictions,
  fetchInferenceMetrics,
  fetchInferencePlot,
  inferenceDownloadUrl,
  fetchInferenceComparison,
} from "../api/inference";
import { PlotlyChart } from "../components/PlotlyChart";
import { formatRelativeTime } from "../utils/formatRelativeTime";

export function InferencePage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navState = location.state as { jobId?: string } | null;

  // Setup state
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    navState?.jobId ?? null,
  );
  const [sourceType, setSourceType] = useState<string>("path");
  const [dataPath, setDataPath] = useState("");
  const [returnShap, setReturnShap] = useState(false);
  const [evaluate, setEvaluate] = useState(true);
  const [running, setRunning] = useState(false);

  // Selected inference result
  const [selectedInfId, setSelectedInfId] = useState<string | null>(null);

  // Track which inference runs had SHAP requested (client-side only)
  const [shapRequestedIds, setShapRequestedIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Pre-run GT detection: null = not checked, true/false = detected/not detected
  const [preDetectedGT, setPreDetectedGT] = useState<boolean | null>(null);

  // Fetch completed jobs for selector
  const jobsQuery = useQuery({
    queryKey: ["jobs", "completed"],
    queryFn: () => fetchJobs("completed"),
  });

  const completedJobs = jobsQuery.data ?? [];

  // Fetch selected job's config to display target column (GT detection)
  const jobConfigQuery = useQuery({
    queryKey: ["job-config", selectedJobId],
    queryFn: () => fetchJobConfig(selectedJobId!),
    enabled: !!selectedJobId,
  });
  const targetColName = useMemo(() => {
    const cfg = jobConfigQuery.data;
    if (!cfg || typeof cfg !== "object") return null;
    const data = (cfg as Record<string, unknown>).data;
    if (data && typeof data === "object") {
      return (data as Record<string, unknown>).target as string | null;
    }
    return (cfg as Record<string, unknown>).target as string | null;
  }, [jobConfigQuery.data]);

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
      const res = await runInference(selectedJobId, dataPath, returnShap, evaluate);
      setSelectedInfId(res.inf_id);
      if (returnShap) {
        setShapRequestedIds((prev) => new Set(prev).add(res.inf_id));
      }
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
  }, [selectedJobId, dataPath, returnShap, evaluate, queryClient, setShapRequestedIds]);

  // Run inference from upload (2-step: upload → run) (H-0015)
  const onDropFiles = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file || !selectedJobId) return;

      // Pre-detect GT: read first line of CSV to check for target column
      if (targetColName && file.name.endsWith(".csv")) {
        try {
          const slice = file.slice(0, 4096);
          const text = await slice.text();
          const firstLine = text.split("\n")[0] ?? "";
          const headers = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
          setPreDetectedGT(headers.includes(targetColName));
        } catch {
          setPreDetectedGT(null);
        }
      }

      setRunning(true);
      try {
        const upload = await uploadInferenceData(file);
        const res = await runInference(
          selectedJobId,
          upload.upload_path,
          returnShap,
          evaluate,
        );
        setSelectedInfId(res.inf_id);
        if (returnShap) {
          setShapRequestedIds((prev) => new Set(prev).add(res.inf_id));
        }
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
    [selectedJobId, returnShap, evaluate, queryClient, setShapRequestedIds],
  );

  // Job select data: "#N type ModelName" format
  const jobSelectData = completedJobs.map((j: JobSummary, idx: number) => ({
    value: j.job_id,
    label: `#${completedJobs.length - idx} ${j.job_type} ${j.model_name || "Unknown"}`,
  }));
  const selectedJob = completedJobs.find((j) => j.job_id === selectedJobId);

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
          {selectedJob && (
            <Text size="xs" c="dimmed">
              {selectedJob.job_type} — {selectedJob.model_name || "Unknown"}
              {selectedJob.primary_score != null && ` — ${selectedJob.primary_score.toFixed(4)}`}
            </Text>
          )}

          {/* Data source selector */}
          <SegmentedControl
            size="xs"
            data={[
              { value: "path", label: "Path" },
              { value: "upload", label: "Upload" },
            ]}
            value={sourceType}
            onChange={(v) => { setSourceType(v); setPreDetectedGT(null); }}
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

          {/* GT detection: pre-detect on upload, or show result from history */}
          {targetColName && (() => {
            // Pre-run detection from uploaded file headers
            if (preDetectedGT === true) {
              return (
                <Text size="xs" c="green">
                  ✓ Target &apos;{targetColName}&apos; detected in uploaded data
                </Text>
              );
            }
            if (preDetectedGT === false) {
              return (
                <Text size="xs" c="orange">
                  Target &apos;{targetColName}&apos; not found — Prediction only
                </Text>
              );
            }
            // Post-run detection from history record
            if (selectedRecord) {
              return (
                <Text size="xs" c={selectedRecord.has_ground_truth ? "green" : "orange"}>
                  {selectedRecord.has_ground_truth
                    ? `Ground truth found — target '${targetColName}' detected in data`
                    : `No ground truth — target '${targetColName}' not found in data`}
                </Text>
              );
            }
            // No detection yet
            return (
              <Text size="xs" c="blue">
                Target &apos;{targetColName}&apos; will be checked
              </Text>
            );
          })()}

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
            Run Inference
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
                {history.map((rec, idx) => (
                  <HistoryRow
                    key={rec.inf_id}
                    record={rec}
                    infNumber={history.length - idx}
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
            completedJobs={completedJobs}
            targetColName={targetColName}
            shapRequested={shapRequestedIds.has(effectiveInfId)}
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
  infNumber,
  selected,
  onClick,
}: {
  record: InferenceRecord;
  infNumber: number;
  selected: boolean;
  onClick: () => void;
}) {
  const time = formatRelativeTime(record.created_at);

  return (
    <Tooltip label={time.absolute} position="right" withArrow>
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
            #{infNumber}
          </Text>
          <Text size="xs" c="dimmed">
            {time.relative}
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
    </Tooltip>
  );
}

// --- Inference Results ---

function InferenceResults({
  infId,
  jobId,
  history,
  completedJobs,
  targetColName,
  shapRequested,
}: {
  infId: string;
  jobId: string;
  history: InferenceRecord[];
  completedJobs: JobSummary[];
  targetColName: string | null;
  shapRequested: boolean;
}) {
  const record = history.find((h) => h.inf_id === infId);
  const hasGT = record?.has_ground_truth ?? false;

  // Inf #N numbering (oldest = 1)
  const infIdx = history.findIndex((h) => h.inf_id === infId);
  const infNumber = infIdx >= 0 ? history.length - infIdx : 0;

  // Job #M + model name
  const selectedJob = completedJobs.find((j) => j.job_id === jobId);
  const jobIdx = completedJobs.findIndex((j) => j.job_id === jobId);
  const jobNumber = jobIdx >= 0 ? completedJobs.length - jobIdx : 0;
  const modelName = selectedJob?.model_name || "Unknown";

  return (
    <Stack gap="md">
      {/* Header */}
      <Group gap="xs">
        <Title order={4}>Inf #{infNumber}</Title>
        <Badge variant="light">Job #{jobNumber} {modelName}</Badge>
        <Badge variant="light">{record?.row_count ?? "?"} rows</Badge>
        {hasGT ? (
          <Badge color="green" leftSection={<IconCheck size={12} />}>
            Ground Truth: &apos;{targetColName}&apos;
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
          shapRequested={shapRequested}
        />
      ) : (
        <NoGTResultsView
          infId={infId}
          jobId={jobId}
          record={record}
          history={history}
          shapRequested={shapRequested}
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
  shapRequested,
}: {
  infId: string;
  jobId: string;
  record: InferenceRecord | undefined;
  shapRequested: boolean;
}) {
  return (
    <>
      {/* Score table (IS / OOS / Inf) */}
      <InferenceMetricsSection infId={infId} jobId={jobId} />

      {/* Evaluation plots */}
      <InferencePlotSection infId={infId} jobId={jobId} />

      {/* Accordion: Prediction Distribution, SHAP, Predictions, Warnings */}
      <Accordion defaultValue={["predictions"]} multiple>
        <Accordion.Item value="prediction-distribution">
          <Accordion.Control>Prediction Distribution</Accordion.Control>
          <Accordion.Panel>
            <GTDistributionSection infId={infId} jobId={jobId} />
          </Accordion.Panel>
        </Accordion.Item>

        {shapRequested && (
          <Accordion.Item value="shap-summary">
            <Accordion.Control>SHAP Summary</Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" c="dimmed">
                SHAP summary will be displayed here when available from the
                backend. This section appears because return_shap was enabled
                for this inference run.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        )}

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
  shapRequested,
}: {
  infId: string;
  jobId: string;
  record: InferenceRecord | undefined;
  history: InferenceRecord[];
  shapRequested: boolean;
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

      {/* Prediction distribution — visual histogram + stats */}
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

      {/* Accordion: SHAP + Distribution Comparison overlay + Warnings */}
      <Accordion multiple>
        {shapRequested && (
          <Accordion.Item value="shap-summary">
            <Accordion.Control>SHAP Summary</Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" c="dimmed">
                SHAP summary will be displayed here when available from the
                backend. This section appears because return_shap was enabled
                for this inference run.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {history.length > 1 && (
          <Accordion.Item value="distribution-comparison">
            <Accordion.Control>Distribution Comparison</Accordion.Control>
            <Accordion.Panel>
              <DistributionOverlay
                infId={infId}
                jobId={jobId}
                history={history}
              />
            </Accordion.Panel>
          </Accordion.Item>
        )}

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

  if (numericVals.length === 0) {
    // Non-numeric predictions: show a frequency summary table
    const freqMap = new Map<string, number>();
    for (const row of data) {
      const key = String(row[predCol] ?? "");
      freqMap.set(key, (freqMap.get(key) ?? 0) + 1);
    }
    const freqEntries = [...freqMap.entries()].sort((a, b) => b[1] - a[1]);

    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Prediction Distribution
        </Text>
        <Table fz="xs" withTableBorder striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Prediction</Table.Th>
              <Table.Th>Count</Table.Th>
              <Table.Th>%</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {freqEntries.map(([label, count]) => (
              <Table.Tr key={label}>
                <Table.Td>{label}</Table.Td>
                <Table.Td>{count}</Table.Td>
                <Table.Td>
                  {((count / data.length) * 100).toFixed(1)}%
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed">
          Showing page 1 of {total_rows} total rows
        </Text>
      </Stack>
    );
  }

  const mean = numericVals.reduce((a, b) => a + b, 0) / numericVals.length;
  const variance =
    numericVals.reduce((a, b) => a + (b - mean) ** 2, 0) / numericVals.length;
  const std = Math.sqrt(variance);
  const min = Math.min(...numericVals);
  const max = Math.max(...numericVals);

  // Build a Plotly histogram JSON for the predictions
  const histogramJson = JSON.stringify({
    data: [
      {
        x: numericVals,
        type: "histogram",
        marker: { color: "rgba(59,130,246,0.6)" },
        name: predCol,
      },
    ],
    layout: {
      title: { text: "Prediction Distribution" },
      xaxis: { title: { text: predCol } },
      yaxis: { title: { text: "Count" } },
      margin: { t: 40, b: 40, l: 50, r: 20 },
      height: 260,
      bargap: 0.05,
    },
  });

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Prediction Distribution
      </Text>
      <Box style={{ height: 260 }}>
        <PlotlyChart json={histogramJson} />
      </Box>
      <Table fz="xs" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Rows</Table.Th>
            <Table.Th>Mean</Table.Th>
            <Table.Th>Std</Table.Th>
            <Table.Th>Min</Table.Th>
            <Table.Th>Max</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>{total_rows}</Table.Td>
            <Table.Td>{mean.toFixed(4)}</Table.Td>
            <Table.Td>{std.toFixed(4)}</Table.Td>
            <Table.Td>{min.toFixed(4)}</Table.Td>
            <Table.Td>{max.toFixed(4)}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// --- GT Prediction Distribution (reuses prediction data for histogram) ---

function GTDistributionSection({
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

  if (predQuery.isLoading) return <Loader size="sm" />;
  if (!predQuery.data) {
    return (
      <Text size="sm" c="dimmed">
        Prediction Distribution data not available.
      </Text>
    );
  }

  const { data, columns } = predQuery.data;
  const predCol =
    columns.find((c) => c.toLowerCase().includes("prediction")) ??
    columns[columns.length - 1];
  if (!predCol) {
    return (
      <Text size="sm" c="dimmed">
        No prediction column found.
      </Text>
    );
  }

  const numericVals = data
    .map((row) => row[predCol])
    .filter((v): v is number => typeof v === "number");

  if (numericVals.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Prediction Distribution — non-numeric predictions (categorical).
      </Text>
    );
  }

  const histogramJson = JSON.stringify({
    data: [
      {
        x: numericVals,
        type: "histogram",
        marker: { color: "rgba(34,197,94,0.6)" },
        name: predCol,
      },
    ],
    layout: {
      xaxis: { title: { text: predCol } },
      yaxis: { title: { text: "Count" } },
      margin: { t: 20, b: 40, l: 50, r: 20 },
      height: 220,
      bargap: 0.05,
    },
  });

  return (
    <Box style={{ height: 220 }}>
      <PlotlyChart json={histogramJson} />
    </Box>
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

  // NOTE: Plot selection uses job-level `available_plots` (inference-context reuse).
  // The inference endpoint re-generates plots in the job's context, so the job's
  // plot type list is used as the selector source. This is acceptable because
  // inference plots are generated against the same model/pipeline.
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

// --- Distribution Overlay (no-GT comparison histogram) ---

function DistributionOverlay({
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

  const currentPredQuery = useQuery({
    queryKey: ["inference-predictions", infId, jobId, 1],
    queryFn: () => fetchInferencePredictions(infId, jobId, 50, 0),
  });

  const otherPredQuery = useQuery({
    queryKey: ["inference-predictions", otherInfId, jobId, 1],
    queryFn: () => fetchInferencePredictions(otherInfId!, jobId, 50, 0),
    enabled: !!otherInfId,
  });

  if (!currentPredQuery.data) return null;

  const extractNumeric = (data: Record<string, unknown>[], columns: string[]) => {
    const predCol =
      columns.find((c) => c.toLowerCase().includes("prediction")) ??
      columns[columns.length - 1];
    if (!predCol) return [];
    return data
      .map((row) => row[predCol])
      .filter((v): v is number => typeof v === "number");
  };

  const currentVals = extractNumeric(
    currentPredQuery.data.data,
    currentPredQuery.data.columns,
  );
  const otherVals = otherPredQuery.data
    ? extractNumeric(otherPredQuery.data.data, otherPredQuery.data.columns)
    : [];

  if (currentVals.length === 0) {
    return <Text size="sm" c="dimmed">No numeric predictions to compare.</Text>;
  }

  const traces: Record<string, unknown>[] = [
    {
      x: currentVals,
      type: "histogram",
      opacity: 0.6,
      marker: { color: "rgba(59,130,246,0.6)" },
      name: `Current (${infId.slice(-6)})`,
    },
  ];
  if (otherVals.length > 0 && otherInfId) {
    traces.push({
      x: otherVals,
      type: "histogram",
      opacity: 0.6,
      marker: { color: "rgba(156,163,175,0.6)" },
      name: `Other (${otherInfId.slice(-6)})`,
    });
  }

  const overlayJson = JSON.stringify({
    data: traces,
    layout: {
      barmode: "overlay",
      xaxis: { title: { text: "Prediction" } },
      yaxis: { title: { text: "Count" } },
      margin: { t: 20, b: 40, l: 50, r: 20 },
      height: 260,
      bargap: 0.05,
      legend: { orientation: "h", y: -0.2 },
    },
  });

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
      <Box style={{ height: 260 }}>
        <PlotlyChart json={overlayJson} />
      </Box>
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
