import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Hook for the shared `?job_id=<id>` URL-param workflow used by both
 * WorkspacePage and InferencePage (docs/coupling-analysis.md B-8).
 *
 * Responsibilities:
 * - Normalize `searchParams.get("job_id")` so an explicitly empty
 *   `?job_id=` value reads back as `null` rather than `""`.
 * - Hydrate an internal state slot from the URL on mount.
 * - Re-sync state when the URL param changes after mount — important
 *   because the initializer only fires once, and external links / Jobs
 *   page navigation can push a new param without remounting the page.
 * - Let callers `suppress` URL-driven updates while a page-local
 *   operation is in flight (e.g. a freshly-started fit/tune job whose
 *   URL hasn't been rewritten yet).
 * - Let callers `filter` URL candidates (e.g. InferencePage only
 *   accepts a job_id once the job appears in the completed list).
 * - Expose `setJobId(next, { writeUrl })` so the caller can update
 *   local state AND optionally push the new value back to
 *   `setSearchParams` in one call.
 */

const PARAM_KEY = "job_id";

export interface UseJobIdParamOptions {
  /**
   * When true, ignore URL→state sync. Workspace uses this during an
   * active fit/tune so a lingering old URL param does not clobber the
   * freshly-started job id owned by page state.
   */
  suppress?: boolean;
  /**
   * Optional validator. When provided, URL-sourced candidate ids are
   * only copied into state when this returns true. Inference uses it
   * to require that the id already appears in the completed-jobs list.
   */
  filter?: (jobId: string) => boolean;
}

export interface UseJobIdParamResult {
  jobId: string | null;
  /**
   * Update the job id. Pass `{ writeUrl: true }` to also push the new
   * value through `setSearchParams` (or clear the param if `next` is
   * `null`); otherwise only the local state slot is touched, matching
   * Workspace's "URL is read-only" convention.
   */
  setJobId: (next: string | null, opts?: { writeUrl?: boolean }) => void;
}

function readParam(params: URLSearchParams): string | null {
  // `""` collapses to null so consumers never have to check both.
  return params.get(PARAM_KEY) || null;
}

export function useJobIdParam(
  options: UseJobIdParamOptions = {},
): UseJobIdParamResult {
  const { suppress = false, filter } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobId, setJobIdState] = useState<string | null>(() =>
    readParam(searchParams),
  );

  // Re-sync state when the URL param changes after mount (e.g. user
  // clicks a "view in Workspace" link while already on the page).
  // `filter` is read directly — storing it in a ref would complicate
  // the API without benefit, and callers already memoize it via
  // `useCallback` when needed.
  useEffect(() => {
    if (suppress) return;
    const candidate = readParam(searchParams);
    if (candidate === null) return;
    if (filter && !filter(candidate)) return;
    setJobIdState(candidate);
  }, [searchParams, suppress, filter]);

  const setJobId = useCallback(
    (next: string | null, opts?: { writeUrl?: boolean }) => {
      setJobIdState(next);
      if (opts?.writeUrl) {
        setSearchParams(
          (prev) => {
            const sp = new URLSearchParams(prev);
            if (next === null) {
              sp.delete(PARAM_KEY);
            } else {
              sp.set(PARAM_KEY, next);
            }
            return sp;
          },
          { replace: false },
        );
      }
    },
    [setSearchParams],
  );

  return { jobId, setJobId };
}
