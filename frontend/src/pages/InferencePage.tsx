import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import {
  useInferenceHistory,
  useInferenceRecord,
  useJob,
  useJobsList,
  useRunInference,
} from "@/api/queries";
import { ResultsPredOnly } from "@/components/inference/ResultsPredOnly";
import { ResultsWithGT } from "@/components/inference/ResultsWithGT";
import { SetupPanel } from "@/components/inference/SetupPanel";
import { useJobIdParam } from "@/hooks/useJobIdParam";
import { getTargetColumn } from "@/lib/job-config";
import { getJobNumber } from "@/lib/job-number";

export function InferencePage() {
  const [selectedInfId, setSelectedInfId] = useState<string | null>(null);

  // Fetch completed jobs
  const { data: allJobs = [] } = useJobsList();

  const completedJobs = useMemo(
    () => allJobs.filter((j) => j.status === "completed"),
    [allJobs],
  );

  // HIGH-4 (pre-B-8 context): URL→state sync must re-run when
  // ``completedJobs`` changes so that a deep-link to ``?job_id=xyz``
  // is honoured the moment ``xyz`` appears in the completed list.
  // ``useJobIdParam`` re-evaluates the filter whenever its identity
  // changes, so we memoize the filter against ``completedJobs``.
  const filterByCompleted = useCallback(
    (id: string) => completedJobs.some((j) => j.job_id === id),
    [completedJobs],
  );
  const { jobId: selectedJobId, setJobId: setSelectedJobId } = useJobIdParam({
    filter: filterByCompleted,
  });

  // Fetch inference history for selected job.
  //
  // HIGH-4: inference records are created explicitly by the mutation
  // below (see onSuccess → invalidate). There is no background source
  // that can produce new records on its own, so the previous five-second
  // `refetchInterval` was pure wasted bandwidth. Rely on the mutation's
  // invalidation instead.
  const { data: history = [] } = useInferenceHistory(selectedJobId);

  // Fetch selected inference record
  const { data: selectedRecord } = useInferenceRecord(
    selectedInfId,
    selectedJobId,
  );

  // Run inference mutation
  const mutation = useRunInference();
  // Issue #559: ``mutation.isPending`` is React state and only flips to
  // true after the next render. A double-click within the same
  // event-loop tick races past the DOM ``disabled`` update and fires
  // two POSTs — discovered by ``inference-run-puts.spec.ts`` during
  // #538. Track the in-flight state synchronously in a ref so the
  // guard works inside one microtask, independent of React's render
  // schedule. ``mutation.isPending`` is kept for the
  // ``isRunning`` prop because the button still needs a visible
  // disabled style.
  const inFlightRef = useRef(false);
  const runInferenceAction = useCallback(
    (params: {
      dataPath: string;
      sourceType: "path" | "upload";
      evaluate: boolean;
      returnShap: boolean;
    }) => {
      if (!selectedJobId) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      mutation.mutate(
        {
          job_id: selectedJobId,
          data: { source_type: params.sourceType, path: params.dataPath },
          return_shap: params.returnShap,
          evaluate: params.evaluate,
        },
        {
          onSuccess: (result) => {
            toast.success("Inference completed");
            setSelectedInfId(result.inf_id);
          },
          onError: (err) => {
            toast.error(`Inference failed: ${getErrorMessage(err)}`);
          },
          onSettled: () => {
            inFlightRef.current = false;
          },
        },
      );
    },
    [mutation, selectedJobId],
  );

  const handleSelectJob = useCallback(
    (jobId: string) => {
      setSelectedJobId(jobId, { writeUrl: true });
      setSelectedInfId(null);
    },
    [setSelectedJobId],
  );

  const handleSelectInf = useCallback((infId: string) => {
    setSelectedInfId(infId);
  }, []);

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

  // Compute job label.
  // Issue #359: derive the ``#N`` against the full all-jobs list (not
  // ``completedJobs``) so the label matches what JobsPage shows.
  const jobLabel = useMemo(() => {
    const job = completedJobs.find((j) => j.job_id === selectedJobId);
    if (!job) return "";
    const num = getJobNumber(job, allJobs);
    return `Job #${num} ${job.model_name}`;
  }, [selectedJobId, completedJobs, allJobs]);

  // Fetch job detail to get config.data.target for ground-truth detection
  const { data: jobDetail } = useJob(selectedJobId);

  const targetCol = useMemo(() => getTargetColumn(jobDetail), [jobDetail]);

  return (
    <div className="flex h-full">
      {/* Left panel: fixed 360px */}
      <div className="w-[360px] shrink-0 border-r">
        <SetupPanel
          completedJobs={completedJobs}
          allJobs={allJobs}
          selectedJobId={selectedJobId}
          onSelectJob={handleSelectJob}
          history={history}
          selectedInfId={selectedInfId}
          onSelectInf={handleSelectInf}
          onRunInference={runInferenceAction}
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
