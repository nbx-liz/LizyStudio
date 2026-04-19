import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import {
  fetchInferenceHistory,
  fetchInferenceRecord,
  runInference,
} from "@/api/inference";
import { fetchJob, fetchJobs } from "@/api/jobs";
import { ResultsPredOnly } from "@/components/inference/ResultsPredOnly";
import { ResultsWithGT } from "@/components/inference/ResultsWithGT";
import { SetupPanel } from "@/components/inference/SetupPanel";

export function InferencePage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedJobId, setSelectedJobId] = useState<string | null>(() =>
    searchParams.get("job_id"),
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

  // Auto-select job from URL param.
  //
  // HIGH-4: read the current value of the `job_id` query param on each
  // run instead of closing over `initialJobId` from first render. That
  // older pattern missed subsequent URL updates because the constant
  // was never recomputed, so navigating to a different job via the URL
  // bar silently kept the first-loaded selection.
  useEffect(() => {
    const jobIdParam = searchParams.get("job_id");
    if (jobIdParam && completedJobs.some((j) => j.job_id === jobIdParam)) {
      setSelectedJobId(jobIdParam);
    }
  }, [searchParams, completedJobs]);

  // Fetch inference history for selected job.
  //
  // HIGH-4: inference records are created explicitly by the mutation
  // below (see onSuccess → invalidate). There is no background source
  // that can produce new records on its own, so the previous five-second
  // `refetchInterval` was pure wasted bandwidth. Rely on the mutation's
  // invalidation instead.
  const { data: history = [] } = useQuery({
    queryKey: ["inf-history", selectedJobId],
    queryFn: () => fetchInferenceHistory(selectedJobId ?? undefined),
    enabled: selectedJobId != null,
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
      toast.error(`Inference failed: ${getErrorMessage(err)}`);
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
    return `Job #${num} ${job.model_name}`;
  }, [selectedJobId, completedJobs]);

  // Fetch job detail to get config.data.target for ground-truth detection
  const { data: jobDetail } = useQuery({
    queryKey: ["job-detail", selectedJobId],
    queryFn: () => fetchJob(selectedJobId ?? ""),
    enabled: selectedJobId != null,
  });

  const targetCol = useMemo(() => {
    if (!jobDetail?.config) return "";
    const data = jobDetail.config.data as Record<string, unknown> | undefined;
    return String(data?.target ?? "");
  }, [jobDetail]);

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
          targetCol={targetCol}
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
