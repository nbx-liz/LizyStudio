/**
 * Compute the user-facing ``#N`` for a job.
 *
 * Jobs are returned newest-first by the API. The number shown to the
 * user is the absolute position from the bottom — i.e. ``allJobs.length
 * - idx``, where ``idx`` is the position in the full all-jobs list.
 *
 * Pages that filter their list (e.g. Inference, which only shows
 * ``completed`` jobs in its model dropdown) MUST still derive the
 * number against the full all-jobs list. Otherwise the same job_id
 * gets a different ``#N`` on different pages, silently mis-attributing
 * inference results to the wrong fit (Issue #359).
 *
 * Returns ``0`` when the job is not in the list (e.g. transient state
 * during cache reconciliation).
 */
import type { JobSummary } from "@/api/types";

export function getJobNumber(job: JobSummary, allJobs: JobSummary[]): number {
  const idx = allJobs.findIndex((j) => j.job_id === job.job_id);
  if (idx < 0) return 0;
  return allJobs.length - idx;
}
