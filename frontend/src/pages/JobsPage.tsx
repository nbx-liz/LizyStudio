import { useCallback, useEffect, useState } from "react";
import { useJobsInvalidator, useJobsList } from "@/api/queries";
import { JobDetailPanel } from "@/components/jobs/JobDetail";
import { JobList } from "@/components/jobs/JobList";

export function JobsPage() {
  const invalidateJobs = useJobsInvalidator();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: jobs = [] } = useJobsList({ refetchInterval: 5000 });

  // Auto-select latest job on first load
  useEffect(() => {
    if (jobs.length > 0 && selectedJobId === null) {
      setSelectedJobId(jobs[0].job_id);
    }
  }, [jobs, selectedJobId]);

  // Compute job number for selected job
  const jobNumber =
    selectedJobId && jobs.length > 0
      ? (() => {
          const idx = jobs.findIndex((j) => j.job_id === selectedJobId);
          return idx >= 0 ? jobs.length - idx : 0;
        })()
      : 0;

  const handleJobDeleted = useCallback(() => {
    setSelectedJobId(null);
    invalidateJobs();
  }, [invalidateJobs]);

  const handleJobChanged = useCallback(() => {
    invalidateJobs();
  }, [invalidateJobs]);

  return (
    <div className="flex h-full">
      {/* Left panel: fixed 360px */}
      <div className="w-[360px] shrink-0">
        <JobList
          jobs={jobs}
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
        />
      </div>

      {/* Right panel: flex */}
      <div className="flex-1">
        {selectedJobId ? (
          <JobDetailPanel
            key={selectedJobId}
            jobId={selectedJobId}
            jobNumber={jobNumber}
            onJobDeleted={handleJobDeleted}
            onJobChanged={handleJobChanged}
            onJobSelect={setSelectedJobId}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select a job to view details
          </div>
        )}
      </div>
    </div>
  );
}
