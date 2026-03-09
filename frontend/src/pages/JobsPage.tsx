import { useState, useCallback, useMemo } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck,
  IconX,
  IconPlayerPlay,
  IconTrash,
  IconDownload,
  IconArrowRight,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import {
  type JobSummary,
  fetchJobs,
  fetchJob,
  fetchJobConfig,
  fetchJobLog,
  deleteJob,
} from "../api/jobs";
import { updateConfig } from "../api/config";
import {
  MetricsTable,
  RunningView,
  TuneResultSection,
  PlotViewer,
  ParamsTable,
  TrialsTable,
  FoldDetailsSection,
  FeatureImportanceSection,
} from "../components/ResultsPanel";
import { ConfigTreeView } from "../components/ConfigTreeView";
import { ExportDialog } from "../components/ExportDialog";
import { formatRelativeTime } from "../utils/formatRelativeTime";

// --- Pulse animation for running badge ---
const pulseKeyframes = `
@keyframes pulse-badge {
  0%   { opacity: 1; }
  50%  { opacity: 0.5; }
  100% { opacity: 1; }
}
`;

export function JobsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<string | null>("all");

  // Selected job
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Export dialog
  const [exportOpened, { open: openExport, close: closeExport }] =
    useDisclosure(false);

  // Delete confirmation modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Fetch jobs list
  const jobsQuery = useQuery({
    queryKey: ["jobs", statusFilter],
    queryFn: () =>
      fetchJobs(statusFilter === "all" ? undefined : statusFilter),
    refetchInterval: 5000,
  });

  // Apply type filter client-side
  const filteredJobs = (jobsQuery.data ?? []).filter(
    (j) => typeFilter === "all" || j.job_type === typeFilter,
  );

  // Auto-select latest job if none selected
  const effectiveJobId = useMemo(() => {
    if (selectedJobId && filteredJobs.some((j) => j.job_id === selectedJobId)) {
      return selectedJobId;
    }
    return filteredJobs.length > 0 ? filteredJobs[0].job_id : null;
  }, [selectedJobId, filteredJobs]);

  const onDeleteRequest = useCallback((jobId: string) => {
    setDeleteTargetId(jobId);
    setDeleteModalOpen(true);
  }, []);

  const onDeleteConfirm = useCallback(async () => {
    if (!deleteTargetId) return;
    setDeleteModalOpen(false);
    try {
      await deleteJob(deleteTargetId);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (effectiveJobId === deleteTargetId) setSelectedJobId(null);
      notifications.show({
        title: "Job deleted",
        message: deleteTargetId,
        color: "green",
      });
    } catch (e) {
      notifications.show({
        title: "Delete failed",
        message: String(e),
        color: "red",
      });
    }
    setDeleteTargetId(null);
  }, [queryClient, effectiveJobId, deleteTargetId]);

  return (
    <Box style={{ display: "flex", gap: 16, height: "calc(100vh - 80px)" }}>
      {/* Pulse animation styles */}
      <style dangerouslySetInnerHTML={{ __html: pulseKeyframes }} />

      {/* Left Panel — Job List */}
      <Paper
        withBorder
        p="sm"
        style={{ width: 360, flexShrink: 0, display: "flex", flexDirection: "column" }}
      >
        <Stack gap="xs" mb="sm">
          <Title order={4}>Jobs</Title>
          <SegmentedControl
            size="xs"
            value={statusFilter}
            onChange={setStatusFilter}
            data={[
              { label: "All", value: "all" },
              { label: "Done", value: "completed" },
              { label: "Run", value: "running" },
              { label: "Fail", value: "failed" },
            ]}
            fullWidth
          />
          <Select
            size="xs"
            data={[
              { label: "All Types", value: "all" },
              { label: "Fit", value: "fit" },
              { label: "Tune", value: "tune" },
            ]}
            value={typeFilter}
            onChange={setTypeFilter}
          />
        </Stack>
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap={4}>
            {filteredJobs.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="xl">
                No jobs yet. Run Fit or Tune from the Workspace.
              </Text>
            )}
            {filteredJobs.map((job) => (
              <JobRow
                key={job.job_id}
                job={job}
                allJobs={jobsQuery.data ?? []}
                selected={job.job_id === effectiveJobId}
                onClick={() => setSelectedJobId(job.job_id)}
              />
            ))}
          </Stack>
        </ScrollArea>
      </Paper>

      {/* Right Panel — Job Detail */}
      <Paper
        withBorder
        p="md"
        style={{ flex: 1, overflow: "auto" }}
      >
        {effectiveJobId ? (
          <JobDetailPanel
            jobId={effectiveJobId}
            allJobs={jobsQuery.data ?? []}
            onDelete={onDeleteRequest}
            onExport={openExport}
            onNavigateWorkspace={() => navigate("/")}
            onNavigateInference={() =>
              navigate("/inference", {
                state: { jobId: effectiveJobId },
              })
            }
          />
        ) : (
          <Stack align="center" justify="center" h="100%">
            <Text c="dimmed">Select a job to view details</Text>
          </Stack>
        )}
      </Paper>

      {/* Export Dialog */}
      {effectiveJobId && (
        <ExportDialog
          opened={exportOpened}
          onClose={closeExport}
          jobId={effectiveJobId}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        opened={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Job"
        centered
      >
        <Text size="sm">
          Are you sure you want to delete job {deleteTargetId}? This action
          cannot be undone.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setDeleteModalOpen(false)}>
            Cancel
          </Button>
          <Button color="red" onClick={onDeleteConfirm}>
            Delete
          </Button>
        </Group>
      </Modal>
    </Box>
  );
}

// --- Job Row ---

function JobRow({
  job,
  allJobs,
  selected,
  onClick,
}: {
  job: JobSummary;
  allJobs: JobSummary[];
  selected: boolean;
  onClick: () => void;
}) {
  const statusIcon =
    job.status === "completed" ? (
      <IconCheck size={14} color="var(--mantine-color-green-6)" />
    ) : job.status === "running" || job.status === "pending" ? (
      <IconPlayerPlay size={14} color="var(--mantine-color-blue-6)" />
    ) : (
      <IconX size={14} color="var(--mantine-color-red-6)" />
    );

  // #N label: reverse order index (latest = highest N)
  const jobIndex = allJobs.length - allJobs.findIndex((j) => j.job_id === job.job_id);
  const jobLabel = `#${jobIndex}`;

  const time = formatRelativeTime(job.created_at);
  const relTime = time.relative;
  const absTime = time.absolute;

  return (
    <Tooltip label={absTime} position="right" withArrow>
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
          {statusIcon}
          <Text size="xs" fw={500} truncate style={{ flex: 1 }}>
            {jobLabel}
          </Text>
          <Badge size="xs" variant="light">
            {job.job_type}
          </Badge>
          {job.model_name && (
            <Text size="xs" c="dimmed" truncate style={{ maxWidth: 80 }}>
              {job.model_name}
            </Text>
          )}
          <Text size="xs" c="dimmed" title={absTime}>
            {relTime}
          </Text>
          <Text size="xs" c="dimmed" style={{ minWidth: 52, textAlign: "right" }}>
            {job.status === "completed" && job.primary_score != null
              ? job.primary_score.toFixed(4)
              : job.status === "running" || job.status === "pending"
                ? "..."
                : "\u2014"}
          </Text>
        </Group>
      </UnstyledButton>
    </Tooltip>
  );
}

// --- Job Detail Panel ---

function JobDetailPanel({
  jobId,
  allJobs,
  onDelete,
  onExport,
  onNavigateWorkspace,
  onNavigateInference,
}: {
  jobId: string;
  allJobs: JobSummary[];
  onDelete: (jobId: string) => void;
  onExport: () => void;
  onNavigateWorkspace: () => void;
  onNavigateInference: () => void;
}) {
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "running" || s === "pending" ? 2000 : false;
    },
  });

  const configQuery = useQuery({
    queryKey: ["job-config", jobId],
    queryFn: () => fetchJobConfig(jobId),
  });

  const logQuery = useQuery({
    queryKey: ["job-log", jobId],
    queryFn: () => fetchJobLog(jobId),
  });

  const refitMutation = useMutation({
    mutationFn: async () => {
      const cfg = await fetchJobConfig(jobId);
      await updateConfig(cfg);
    },
    onSuccess: () => {
      onNavigateWorkspace();
    },
    onError: (e) => {
      notifications.show({
        title: "Re-fit config load failed",
        message: String(e),
        color: "red",
      });
    },
  });

  if (jobQuery.isLoading) {
    return (
      <Stack align="center" py="xl">
        <Loader />
      </Stack>
    );
  }

  if (jobQuery.error || !jobQuery.data) {
    return (
      <Alert color="red">Failed to load job details.</Alert>
    );
  }

  const job = jobQuery.data;
  const config = configQuery.data;

  // Header: #N format + model name
  const jobNumber = (() => {
    const idx = allJobs.findIndex((j) => j.job_id === job.job_id);
    return idx >= 0 ? allJobs.length - idx : 0;
  })();
  const modelName = job.model_name || "Unknown";
  const header = (
    <Group justify="space-between" mb="md">
      <Group gap="xs">
        <Title order={4}>
          {job.job_type === "fit" ? "Fit" : "Tune"} #{jobNumber} — {modelName}
        </Title>
        <StatusBadge status={job.status} />
      </Group>
    </Group>
  );

  // Running state — show RunningView with Cancel
  if (job.status === "running" || job.status === "pending") {
    return (
      <Stack>
        {header}
        <RunningView
          jobId={job.job_id}
          jobType={job.job_type}
          modelName={modelName}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ["job", jobId] });
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
          }}
        />
        {config && <ConfigAccordion config={config} />}
      </Stack>
    );
  }

  // Failed state
  if (job.status === "failed") {
    return (
      <Stack>
        {header}
        <Alert color="red" icon={<IconX size={16} />}>
          {job.error ?? "Unknown error"}
        </Alert>
        {config && <ConfigAccordion config={config} />}
        <Group mt="md">
          <Button
            size="xs"
            variant="light"
            leftSection={<IconArrowRight size={14} />}
            loading={refitMutation.isPending}
            onClick={() => refitMutation.mutate()}
          >
            Re-fit
          </Button>
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => onDelete(jobId)}
          >
            Delete
          </Button>
        </Group>
      </Stack>
    );
  }

  // Completed state
  return (
    <Stack>
      {header}

      {/* Tune-specific */}
      {job.tune_result && <TuneResultSection tuneResult={job.tune_result} />}

      {/* Score */}
      {job.fit_result && <MetricsTable fitResult={job.fit_result} />}

      {/* Plots */}
      <PlotViewer jobId={job.job_id} />

      {/* Accordion details */}
      <Accordion>
        {/* Feature Importance */}
        <Accordion.Item value="feature-importance">
          <Accordion.Control>Feature Importance</Accordion.Control>
          <Accordion.Panel>
            <FeatureImportanceSection jobId={job.job_id} />
          </Accordion.Panel>
        </Accordion.Item>

        {/* Fold Details (CV) */}
        {job.fit_result && job.fit_result.fold_count > 1 && (
          <Accordion.Item value="fold-details">
            <Accordion.Control>Fold Details</Accordion.Control>
            <Accordion.Panel>
              <FoldDetailsSection jobId={job.job_id} />
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
        {config && (
          <Accordion.Item value="config">
            <Accordion.Control>Config</Accordion.Control>
            <Accordion.Panel>
              <ConfigTreeView data={config} defaultExpandDepth={1} />
            </Accordion.Panel>
          </Accordion.Item>
        )}
        <Accordion.Item value="execution-log">
          <Accordion.Control>Execution Log</Accordion.Control>
          <Accordion.Panel>
            {logQuery.isLoading ? (
              <Loader size="sm" />
            ) : logQuery.data?.log ? (
              <Code
                block
                style={{
                  whiteSpace: "pre-wrap",
                  maxHeight: 400,
                  overflow: "auto",
                }}
              >
                {logQuery.data.log}
              </Code>
            ) : (
              <Text size="sm" c="dimmed">
                No execution log available
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {/* Action buttons */}
      <Group mt="md">
        <Button
          size="xs"
          leftSection={<IconArrowRight size={14} />}
          onClick={onNavigateInference}
        >
          Inference
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconDownload size={14} />}
          onClick={onExport}
        >
          Export
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconArrowRight size={14} />}
          loading={refitMutation.isPending}
          onClick={() => refitMutation.mutate()}
        >
          Re-fit
        </Button>
        <Button
          size="xs"
          variant="light"
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={() => onDelete(jobId)}
        >
          Delete
        </Button>
      </Group>
    </Stack>
  );
}

// --- Helpers ---

function StatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return (
      <Badge color="green" leftSection={<IconCheck size={12} />}>
        Completed
      </Badge>
    );
  if (status === "running" || status === "pending")
    return (
      <Badge
        color="blue"
        style={{ animation: "pulse-badge 1.5s ease-in-out infinite" }}
      >
        Running
      </Badge>
    );
  return (
    <Badge color="red" leftSection={<IconX size={12} />}>
      Failed
    </Badge>
  );
}

function ConfigAccordion({ config }: { config: Record<string, unknown> }) {
  return (
    <Accordion>
      <Accordion.Item value="config">
        <Accordion.Control>Config</Accordion.Control>
        <Accordion.Panel>
          <ConfigTreeView data={config} defaultExpandDepth={1} />
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
