import { useState, useCallback } from "react";
import {
  Accordion,
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Badge,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconX, IconInfoCircle } from "@tabler/icons-react";

import {
  type FitResult,
  type TuneResult,
  fetchJob,
  fetchJobPlot,
  fetchJobPlots,
  runFit,
  runTune,
} from "../api/jobs";
import { PlotlyChart } from "./PlotlyChart";

interface ResultsPanelProps {
  jobId: string | null;
  onJobCreated?: (jobId: string) => void;
}

export function ResultsPanel({ jobId, onJobCreated }: ResultsPanelProps) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 2000 : false;
    },
  });

  const onFit = useCallback(async () => {
    setRunning(true);
    try {
      const res = await runFit();
      onJobCreated?.(res.job_id);
      queryClient.invalidateQueries({ queryKey: ["job"] });
    } catch (e) {
      notifications.show({ title: "Fit failed", message: String(e), color: "red" });
    } finally {
      setRunning(false);
    }
  }, [onJobCreated, queryClient]);

  const onTuneClick = useCallback(async () => {
    setRunning(true);
    try {
      const res = await runTune();
      onJobCreated?.(res.job_id);
      queryClient.invalidateQueries({ queryKey: ["job"] });
    } catch (e) {
      notifications.show({ title: "Tune failed", message: String(e), color: "red" });
    } finally {
      setRunning(false);
    }
  }, [onJobCreated, queryClient]);

  // No job yet — show guide
  if (!jobId || !jobQuery.data) {
    return (
      <Paper p="md" withBorder>
        <Stack align="center" gap="md" py="xl">
          <Title order={5}>Results</Title>
          <Text c="dimmed" size="sm" ta="center">
            1. Load data in Data Panel{"\n"}
            2. Configure model in Model Panel{"\n"}
            3. Click Fit or Tune below
          </Text>
          <Group>
            <Button onClick={onFit} loading={running}>
              Fit
            </Button>
            <Button variant="light" onClick={onTuneClick} loading={running}>
              Tune
            </Button>
          </Group>
        </Stack>
      </Paper>
    );
  }

  const job = jobQuery.data;

  // Running
  if (job.status === "running" || job.status === "pending") {
    return (
      <Paper p="md" withBorder>
        <Stack align="center" gap="md" py="xl">
          <Group>
            <Title order={5}>
              {job.job_type === "fit" ? "Fit" : "Tune"} — {job.job_id}
            </Title>
            <Badge color="blue">Running</Badge>
          </Group>
          <Loader />
          <Text size="sm" c="dimmed">
            Processing...
          </Text>
        </Stack>
      </Paper>
    );
  }

  // Failed
  if (job.status === "failed") {
    return (
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group>
            <Title order={5}>
              {job.job_type === "fit" ? "Fit" : "Tune"} — {job.job_id}
            </Title>
            <Badge color="red" leftSection={<IconX size={12} />}>
              Failed
            </Badge>
          </Group>
          <Alert color="red" icon={<IconX size={16} />}>
            {job.error ?? "Unknown error"}
          </Alert>
          <Group>
            <Button onClick={onFit} loading={running}>
              Retry Fit
            </Button>
          </Group>
        </Stack>
      </Paper>
    );
  }

  // Completed
  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        <Group>
          <Title order={5}>
            {job.job_type === "fit" ? "Fit" : "Tune"} — {job.job_id}
          </Title>
          <Badge color="green" leftSection={<IconCheck size={12} />}>
            Completed
          </Badge>
        </Group>

        {/* Tune-specific sections */}
        {job.tune_result && <TuneResultSection tuneResult={job.tune_result} />}

        {/* Score (from fit_result) */}
        {job.fit_result && <MetricsTable fitResult={job.fit_result} />}

        {/* Plots */}
        <PlotViewer jobId={job.job_id} />

        {/* Accordion details */}
        <Accordion>
          {job.fit_result && job.fit_result.fold_count > 1 && (
            <Accordion.Item value="fold-details">
              <Accordion.Control>Fold Details</Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" c="dimmed">
                  {job.fit_result.fold_count} folds
                </Text>
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

        <Group>
          <Button onClick={onFit} loading={running}>
            Fit
          </Button>
          <Button variant="light" onClick={onTuneClick} loading={running}>
            Tune
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

// --- Sub-components (exported for reuse in JobDetail) ---

export function MetricsTable({ fitResult }: { fitResult: FitResult }) {
  const metrics = fitResult.metrics;
  if (!metrics || typeof metrics !== "object") return null;
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

export function TuneResultSection({ tuneResult }: { tuneResult: TuneResult }) {
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
