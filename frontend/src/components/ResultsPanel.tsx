import { useState, useEffect, useRef } from "react";
import {
  Accordion,
  Alert,
  Button,
  Group,
  Modal,
  Paper,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Badge,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconX, IconInfoCircle, IconPlayerStop } from "@tabler/icons-react";

import {
  type FitResult,
  type TuneResult,
  cancelJob,
  fetchJob,
  fetchJobConfig,
  fetchJobImportance,
  fetchJobPlot,
  fetchJobPlots,
  fetchJobSplitSummary,
} from "../api/jobs";
import { updateConfig as updateConfigApi } from "../api/config";
import {
  type ProgressMessage,
  connectJobProgress,
} from "../api/websocket";
import { PlotlyChart } from "./PlotlyChart";

interface ResultsPanelProps {
  jobId: string | null;
  onJobCreated?: (jobId: string) => void;
}

export function ResultsPanel({ jobId, onJobCreated }: ResultsPanelProps) {
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 2000 : false;
    },
  });

  // No job yet — show guide
  if (!jobId || !jobQuery.data) {
    return (
      <Paper p="md" withBorder>
        <Stack align="center" gap="md" py="xl">
          <Title order={5}>Results</Title>
          <Text c="dimmed" size="sm" ta="center">
            1. Load data in Data Panel{"\n"}
            2. Configure model in Model Panel{"\n"}
            3. Click Fit or Tune in the Model Panel header
          </Text>
        </Stack>
      </Paper>
    );
  }

  const job = jobQuery.data;

  // Running
  if (job.status === "running" || job.status === "pending") {
    return (
      <Paper p="md" withBorder>
        <RunningView jobId={job.job_id} jobType={job.job_type} modelName={getModelName(job)} onDone={() => {
          queryClient.invalidateQueries({ queryKey: ["job", jobId] });
        }} />
      </Paper>
    );
  }

  // Failed
  if (job.status === "failed") {
    return (
      <Paper p="md" withBorder>
        <FailedView job={job} />
      </Paper>
    );
  }

  // Extract primary metric for header
  const primaryMetric = getPrimaryMetric(job.fit_result);
  const modelName = getModelName(job);

  // Completed
  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        {/* Header: Fit #N — Model — Status — Score */}
        <Group>
          <Title order={5}>
            {job.job_type === "fit" ? "Fit" : "Tune"} — {modelName}
          </Title>
          <Badge color="green" leftSection={<IconCheck size={12} />}>
            Completed
          </Badge>
          {primaryMetric && (
            <Badge variant="light">{primaryMetric}</Badge>
          )}
        </Group>

        {/* Tune-specific sections */}
        {job.tune_result && (
          <TuneResultSection
            tuneResult={job.tune_result}
            jobId={job.job_id}
            onApplyToFit={onJobCreated}
          />
        )}

        {/* Score (from fit_result) */}
        {job.fit_result && <MetricsTable fitResult={job.fit_result} />}

        {/* Learning Curve (always show for completed fit) */}
        <LearningCurveSection jobId={job.job_id} />

        {/* Accordion details */}
        <Accordion>
          {/* Feature Importance */}
          <Accordion.Item value="feature-importance">
            <Accordion.Control>Feature Importance</Accordion.Control>
            <Accordion.Panel>
              <FeatureImportanceSection jobId={job.job_id} />
            </Accordion.Panel>
          </Accordion.Item>

          {/* Fold Details table (CV) */}
          {job.fit_result && job.fit_result.fold_count > 1 && (
            <Accordion.Item value="fold-details">
              <Accordion.Control>Fold Details</Accordion.Control>
              <Accordion.Panel>
                <FoldDetailsSection jobId={job.job_id} />
              </Accordion.Panel>
            </Accordion.Item>
          )}

          {/* Optimization History (Tune) */}
          {job.tune_result && (
            <Accordion.Item value="optimization-history">
              <Accordion.Control>Optimization History</Accordion.Control>
              <Accordion.Panel>
                <OptimizationHistorySection jobId={job.job_id} />
              </Accordion.Panel>
            </Accordion.Item>
          )}

          {job.fit_result && (
            <Accordion.Item value="params">
              <Accordion.Control>Parameters</Accordion.Control>
              <Accordion.Panel>
                <ParamsTable params={job.fit_result.params} />
              </Accordion.Panel>
            </Accordion.Item>
          )}
          {job.tune_result && (
            <Accordion.Item value="trials">
              <Accordion.Control>Trial Results</Accordion.Control>
              <Accordion.Panel>
                <TrialsTable
                  trials={job.tune_result.trials}
                  bestScore={job.tune_result.best_score}
                />
              </Accordion.Panel>
            </Accordion.Item>
          )}
        </Accordion>

        {/* Additional plots */}
        <PlotViewer jobId={job.job_id} />
      </Stack>
    </Paper>
  );
}

// --- Helpers for header display ---

function getPrimaryMetric(fitResult?: FitResult): string | null {
  if (!fitResult?.metrics) return null;
  const raw = (fitResult.metrics as Record<string, unknown>).raw as Record<string, unknown> | undefined;
  if (!raw?.oof || typeof raw.oof !== "object") return null;
  const oof = raw.oof as Record<string, number>;
  const first = Object.entries(oof)[0];
  return first ? `${first[0]} ${first[1].toFixed(4)}` : null;
}

function getModelName(job: { job_id: string; config?: Record<string, unknown>; model_name?: string }): string {
  if (job.model_name) return job.model_name;
  const config = job.config;
  if (config) {
    const model = config.model;
    if (model && typeof model === "object" && model !== null) {
      const name = (model as Record<string, unknown>).name;
      if (typeof name === "string" && name) return name;
    }
  }
  return job.job_id;
}

// --- Learning Curve Section ---

function LearningCurveSection({ jobId }: { jobId: string }) {
  const plotQuery = useQuery({
    queryKey: ["job-plot", jobId, "learning-curve"],
    queryFn: () => fetchJobPlot(jobId, "learning-curve"),
  });
  if (!plotQuery.data) return null;
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">Learning Curve</Text>
      <PlotlyChart json={plotQuery.data.plotly_json} />
    </Stack>
  );
}

// --- Feature Importance Section ---

export function FeatureImportanceSection({ jobId }: { jobId: string }) {
  const importanceQuery = useQuery({
    queryKey: ["job-importance", jobId],
    queryFn: () => fetchJobImportance(jobId),
  });
  if (!importanceQuery.data) {
    return <Text size="sm" c="dimmed">Loading...</Text>;
  }
  const data = importanceQuery.data;
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (entries.length === 0) return <Text size="sm" c="dimmed">No importance data</Text>;

  return (
    <Table fz="xs" withTableBorder striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Feature</Table.Th>
          <Table.Th>Importance</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {entries.map(([name, value]) => (
          <Table.Tr key={name}>
            <Table.Td>{name}</Table.Td>
            <Table.Td>{value.toFixed(4)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// --- Fold Details Section ---

export function FoldDetailsSection({ jobId }: { jobId: string }) {
  const splitQuery = useQuery({
    queryKey: ["job-split-summary", jobId],
    queryFn: () => fetchJobSplitSummary(jobId),
  });
  if (!splitQuery.data) return <Text size="sm" c="dimmed">Loading...</Text>;
  const rows = splitQuery.data;
  if (rows.length === 0) return <Text size="sm" c="dimmed">No fold data</Text>;
  const keys = Object.keys(rows[0]);
  return (
    <Table fz="xs" withTableBorder striped>
      <Table.Thead>
        <Table.Tr>
          {keys.map((k) => <Table.Th key={k}>{k}</Table.Th>)}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row, i) => (
          <Table.Tr key={i}>
            {keys.map((k) => <Table.Td key={k}>{String(row[k] ?? "")}</Table.Td>)}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// --- Optimization History Section (Tune) ---

function OptimizationHistorySection({ jobId }: { jobId: string }) {
  const plotQuery = useQuery({
    queryKey: ["job-plot", jobId, "tuning"],
    queryFn: () => fetchJobPlot(jobId, "tuning"),
  });
  if (!plotQuery.data) return <Text size="sm" c="dimmed">No tuning plot available</Text>;
  return <PlotlyChart json={plotQuery.data.plotly_json} />;
}

// --- Running view with WebSocket progress ---

export function RunningView({
  jobId,
  jobType,
  modelName,
  onDone,
}: {
  jobId: string;
  jobType: string;
  modelName?: string;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState<ProgressMessage | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const [cancelOpened, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  // Elapsed time timer
  useEffect(() => {
    startRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [jobId]);

  // WebSocket connection
  useEffect(() => {
    const disconnect = connectJobProgress(jobId, {
      onProgress: (msg) => setProgress(msg),
      onCompleted: () => onDone(),
      onError: () => onDone(),
      onDisconnect: () => {
        // Fallback: poll will pick up the change via refetchInterval
      },
    });
    return disconnect;
  }, [jobId, onDone]);

  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <Stack align="center" gap="md" py="xl">
      <Group>
        <Title order={5}>
          {jobType === "fit" ? "Fit" : "Tune"} — {modelName || jobId}
        </Title>
        <Badge color="blue">Running</Badge>
      </Group>
      {progress ? (
        <>
          <Text size="sm" fw={500}>
            {progress.message}
          </Text>
          <Progress value={pct} size="lg" w="80%" animated />
          <Text size="xs" c="dimmed">
            {progress.current} / {progress.total} ({pct}%)
          </Text>
        </>
      ) : (
        <>
          <Progress value={100} size="lg" w="80%" animated striped />
          <Text size="sm" c="dimmed">
            Starting...
          </Text>
        </>
      )}
      <Text size="xs" c="dimmed">
        Elapsed: {mins}m {secs.toString().padStart(2, "0")}s
      </Text>
      <Button
        variant="light"
        color="red"
        size="xs"
        leftSection={<IconPlayerStop size={14} />}
        onClick={openCancel}
      >
        Cancel
      </Button>

      {/* Cancel Confirmation Dialog */}
      <Modal opened={cancelOpened} onClose={closeCancel} title="Cancel Job" centered>
        <Text size="sm">
          Are you sure you want to cancel this job? This action cannot be undone.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={closeCancel}>
            Keep Running
          </Button>
          <Button
            color="red"
            onClick={() => {
              closeCancel();
              cancelJob(jobId).then(() => onDone()).catch(() => {
                notifications.show({ title: "Cancel failed", message: "Could not cancel the job.", color: "red" });
              });
            }}
          >
            Cancel Job
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}

// --- Sub-components (exported for reuse in JobDetail) ---

// --- IS / OOS / OOS Std metrics table ---

interface StructuredMetrics {
  raw?: {
    oof?: Record<string, number>;
    if_mean?: Record<string, number>;
    if_per_fold?: Array<Record<string, number>>;
  };
}

/**
 * Compute standard deviation across fold values for a given metric.
 */
function computeStd(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqSum = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  return Math.sqrt(sqSum / (values.length - 1));
}

function hasStructuredMetrics(
  metrics: Record<string, unknown>,
): boolean {
  if (!metrics.raw || typeof metrics.raw !== "object") return false;
  const raw = metrics.raw as Record<string, unknown>;
  return (
    typeof raw.oof === "object" ||
    typeof raw.if_mean === "object" ||
    Array.isArray(raw.if_per_fold)
  );
}

function toStructuredMetrics(
  metrics: Record<string, unknown>,
): StructuredMetrics {
  return metrics as unknown as StructuredMetrics;
}

export function MetricsTable({ fitResult }: { fitResult: FitResult }) {
  const metrics = fitResult.metrics;
  if (!metrics || typeof metrics !== "object") return null;

  // Try structured IS/OOS format
  if (hasStructuredMetrics(metrics)) {
    return (
      <StructuredMetricsTable
        metrics={toStructuredMetrics(metrics)}
        foldCount={fitResult.fold_count}
      />
    );
  }

  // Fallback: flat key-value pairs
  const rows = Object.entries(metrics);
  if (rows.length === 0) return null;

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Score
      </Text>
      <Table fz="xs" withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Metric</Table.Th>
            <Table.Th>Value</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(([key, val]) => (
            <Table.Tr key={key}>
              <Table.Td>{key}</Table.Td>
              <Table.Td>{formatMetric(val)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function StructuredMetricsTable({
  metrics,
  foldCount,
}: {
  metrics: StructuredMetrics;
  foldCount: number;
}) {
  const raw = metrics.raw;
  if (!raw) return null;

  const isMean = raw.if_mean ?? {};
  const oof = raw.oof ?? {};
  const perFold = raw.if_per_fold ?? [];
  const showOosStd = foldCount > 1;

  // Collect all metric names from any source
  const metricNames = Array.from(
    new Set([...Object.keys(isMean), ...Object.keys(oof)]),
  );
  if (metricNames.length === 0) return null;

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Score
      </Text>
      <Table fz="xs" withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Metric</Table.Th>
            <Table.Th>IS</Table.Th>
            <Table.Th>OOS</Table.Th>
            {showOosStd && <Table.Th>OOS Std</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {metricNames.map((name) => {
            const isVal = isMean[name];
            const oosVal = oof[name];
            const foldValues = perFold
              .map((f) => f[name])
              .filter((v): v is number => typeof v === "number");
            const oosStd =
              foldValues.length > 1 ? computeStd(foldValues) : undefined;

            return (
              <Table.Tr key={name}>
                <Table.Td>{name}</Table.Td>
                <Table.Td>
                  {isVal != null ? isVal.toFixed(4) : "—"}
                </Table.Td>
                <Table.Td>
                  {oosVal != null ? oosVal.toFixed(4) : "—"}
                </Table.Td>
                {showOosStd && (
                  <Table.Td>
                    {oosStd != null ? oosStd.toFixed(4) : "—"}
                  </Table.Td>
                )}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// --- Failed view with error log modal ---

function FailedView({
  job,
}: {
  job: { job_id: string; job_type: string; error: string | null; config?: Record<string, unknown>; model_name?: string };
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const errorText = job.error ?? "Unknown error";
  const modelName = getModelName(job);

  return (
    <Stack gap="md">
      <Group>
        <Title order={5}>
          {job.job_type === "fit" ? "Fit" : "Tune"} — {modelName}
        </Title>
        <Badge color="red" leftSection={<IconX size={12} />}>
          Failed
        </Badge>
      </Group>
      <Alert color="red" icon={<IconX size={16} />}>
        {errorText.length > 200 ? errorText.slice(0, 200) + "..." : errorText}
      </Alert>
      <Button variant="light" onClick={open}>
        View Full Log
      </Button>
      <Modal opened={opened} onClose={close} title="Error Log" size="lg">
        <Text
          size="xs"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {errorText}
        </Text>
      </Modal>
    </Stack>
  );
}

export function TuneResultSection({
  tuneResult,
  jobId,
  onApplyToFit,
}: {
  tuneResult: TuneResult;
  jobId?: string;
  onApplyToFit?: (jobId: string) => void;
}) {
  const queryClient = useQueryClient();

  const applyToFit = async () => {
    if (!jobId) return;
    try {
      const jobConfig = await fetchJobConfig(jobId);
      // Merge best_params into config for fit
      const merged = structuredClone(jobConfig);
      // Apply best params to model params
      if (typeof merged.model !== "object" || merged.model === null) {
        merged.model = {};
      }
      (merged.model as Record<string, unknown>).params = tuneResult.best_params;
      // Remove tuning section for fit
      delete merged.tuning;
      await updateConfigApi(merged);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      notifications.show({
        title: "Applied to Fit",
        message: "Best params loaded into config. Switch to Fit tab to run.",
        color: "green",
      });
    } catch (e) {
      notifications.show({ title: "Apply failed", message: String(e), color: "red" });
    }
  };

  return (
    <Stack gap="xs">
      <Alert icon={<IconInfoCircle size={16} />} variant="light" color="blue">
        Best {tuneResult.metric_name}: {tuneResult.best_score.toFixed(4)} ({tuneResult.direction})
      </Alert>
      <Text fw={600} size="sm">
        Best Params
      </Text>
      <Table fz="xs" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Param</Table.Th>
            <Table.Th>Value</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {Object.entries(tuneResult.best_params).map(([k, v]) => (
            <Table.Tr key={k}>
              <Table.Td>{k}</Table.Td>
              <Table.Td>{String(v)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {jobId && onApplyToFit && (
        <Button size="xs" variant="light" onClick={applyToFit}>
          Apply to Fit
        </Button>
      )}
    </Stack>
  );
}

export function PlotViewer({ jobId }: { jobId: string }) {
  const [plotType, setPlotType] = useState<string | null>(null);

  const plotsQuery = useQuery({
    queryKey: ["job-plots", jobId],
    queryFn: () => fetchJobPlots(jobId),
  });

  const plotQuery = useQuery({
    queryKey: ["job-plot", jobId, plotType],
    queryFn: () => fetchJobPlot(jobId, plotType!),
    enabled: !!plotType,
  });

  const availablePlots = plotsQuery.data ?? [];

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

export function ParamsTable({ params }: { params: Array<Record<string, unknown>> }) {
  if (params.length === 0) return <Text size="sm" c="dimmed">No parameters</Text>;
  const keys = Object.keys(params[0]);
  return (
    <Table fz="xs" withTableBorder striped>
      <Table.Thead>
        <Table.Tr>
          {keys.map((k) => (
            <Table.Th key={k}>{k}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {params.map((row, i) => (
          <Table.Tr key={i}>
            {keys.map((k) => (
              <Table.Td key={k}>{String(row[k] ?? "")}</Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function TrialsTable({
  trials,
  bestScore,
}: {
  trials: Array<Record<string, unknown>>;
  bestScore: number;
}) {
  if (trials.length === 0) return null;
  return (
    <Table fz="xs" withTableBorder striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Trial</Table.Th>
          <Table.Th>Score</Table.Th>
          <Table.Th>Params</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {trials.map((t) => {
          const score = Number(t.score);
          const isBest = Math.abs(score - bestScore) < 1e-8;
          return (
            <Table.Tr key={String(t.number)} bg={isBest ? "var(--mantine-color-green-0)" : undefined}>
              <Table.Td>
                {isBest ? "★ " : ""}
                {String(t.number)}
              </Table.Td>
              <Table.Td>{score.toFixed(4)}</Table.Td>
              <Table.Td>
                <Text size="xs" lineClamp={1}>
                  {JSON.stringify(t.params)}
                </Text>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function formatMetric(val: unknown): string {
  if (typeof val === "number") return val.toFixed(4);
  if (typeof val === "object" && val !== null) {
    return JSON.stringify(val);
  }
  return String(val);
}
