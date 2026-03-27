import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  fetchInferenceHistory,
  fetchInferenceRecord,
  runInference,
} from "@/api/inference";
import { fetchJobs } from "@/api/jobs";
import type { JobSummary } from "@/api/types";
import { ResultsPredOnly } from "@/components/inference/ResultsPredOnly";
import { ResultsWithGT } from "@/components/inference/ResultsWithGT";
import { SetupPanel } from "@/components/inference/SetupPanel";

export function InferencePage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialJobId = searchParams.get("job_id");

  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    initialJobId,
  );
  const [selectedInfId, setSelectedInfId] = useState<string | null>(null);

  // Fetch completed jobs
  const { data: allJobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => fetchJobs(),
  });

  const completedJobs = useMemo(
    () => allJobs.filter((j) => j.status === "completed"),
    [allJobs],
  );

  // Auto-select job from URL param
  useEffect(() => {
    if (initialJobId && completedJobs.some((j) => j.job_id === initialJobId)) {
      setSelectedJobId(initialJobId);
    }
  }, [initialJobId, completedJobs]);

  // Fetch inference history for selected job
  const { data: history = [] } = useQuery({
    queryKey: ["inf-history", selectedJobId],
    queryFn: () => fetchInferenceHistory(selectedJobId ?? undefined),
    enabled: selectedJobId != null,
    refetchInterval: 5000,
  });

  // Fetch selected inference record
  const { data: selectedRecord } = useQuery({
    queryKey: ["inf-record", selectedInfId, selectedJobId],
    queryFn: () =>
      fetchInferenceRecord(selectedInfId ?? "", selectedJobId ?? ""),
    enabled: selectedInfId != null && selectedJobId != null,
  });

  // Run inference mutation
  const mutation = useMutation({
    mutationFn: (params: {
      dataPath: string;
      evaluate: boolean;
      returnShap: boolean;
    }) => {
      if (!selectedJobId) {
        return Promise.reject(new Error("No job selected"));
      }
      return runInference({
        job_id: selectedJobId,
        data: { source_type: "path", path: params.dataPath },
        return_shap: params.returnShap,
        evaluate: params.evaluate,
      });
    },
    onSuccess: (result) => {
      toast.success("Inference completed");
      queryClient.invalidateQueries({ queryKey: ["inf-history"] });
      setSelectedInfId(result.inf_id);
    },
    onError: (err) => {
      toast.error(
        `Inference failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const handleSelectJob = useCallback(
    (jobId: string) => {
      setSelectedJobId(jobId);
      setSelectedInfId(null);
      setSearchParams({ job_id: jobId });
    },
    [setSearchParams],
  );

  const handleSelectInf = useCallback((infId: string) => {
    setSelectedInfId(infId);
  }, []);

  const handleRunInference = useCallback(
    (params: { dataPath: string; evaluate: boolean; returnShap: boolean }) => {
      mutation.mutate(params);
    },
    [mutation.mutate],
  );

  // Auto-select latest inference when history loads
  useEffect(() => {
    if (history.length > 0 && selectedInfId === null) {
      setSelectedInfId(history[0].inf_id);
    }
  }, [history, selectedInfId]);

  // Compute inference number
  const infNumber = useMemo(() => {
    if (!selectedInfId || history.length === 0) return 0;
    const idx = history.findIndex((r) => r.inf_id === selectedInfId);
    return idx >= 0 ? history.length - idx : 0;
  }, [selectedInfId, history]);

  // Compute job label
  const jobLabel = useMemo(() => {
    const job = completedJobs.find((j) => j.job_id === selectedJobId);
    if (!job) return "";
    const num = completedJobs.length - completedJobs.indexOf(job);
    return `Job #${num} ${extractModelName(job)}`;
  }, [selectedJobId, completedJobs]);

  // Target column from job config
  // TODO: config is not in JobSummary type. GET /jobs list does not return config.
  // Either add config to the list endpoint or fetch job detail separately.
  const targetCol = useMemo(() => {
    const job = completedJobs.find((j) => j.job_id === selectedJobId) as
      | (JobSummary & { config?: Record<string, unknown> })
      | undefined;
    if (!job?.config) return "";
    const data = job.config.data as Record<string, unknown> | undefined;
    return String(data?.target ?? "");
  }, [selectedJobId, completedJobs]);

  return (
    <div className="flex h-full">
      {/* Left panel: fixed 360px */}
      <div className="w-[360px] shrink-0 border-r">
        <SetupPanel
          completedJobs={completedJobs}
          selectedJobId={selectedJobId}
          onSelectJob={handleSelectJob}
          history={history}
          selectedInfId={selectedInfId}
          onSelectInf={handleSelectInf}
          onRunInference={handleRunInference}
          isRunning={mutation.isPending}
        />
      </div>

      {/* Right panel: flex */}
      <div className="flex-1">
        {selectedRecord ? (
          selectedRecord.has_ground_truth ? (
            <ResultsWithGT
              key={selectedRecord.inf_id}
              record={selectedRecord}
              infNumber={infNumber}
              jobLabel={jobLabel}
              targetCol={targetCol}
            />
          ) : (
            <ResultsPredOnly
              key={selectedRecord.inf_id}
              record={selectedRecord}
              infNumber={infNumber}
              jobLabel={jobLabel}
              history={history}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {selectedJobId
              ? "Run inference or select from history"
              : "Select a model to get started"}
          </div>
        )}
      </div>
    </div>
  );
}

function extractModelName(job: JobSummary): string {
  const config = (job as JobSummary & { config?: Record<string, unknown> })
    .config;
  if (!config) return "";
  const model = config.model as Record<string, unknown> | undefined;
  return String(model?.name ?? model?.type ?? "");
}
