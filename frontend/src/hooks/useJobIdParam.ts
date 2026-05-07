import { useCallback, useEffect, useRef, useState } from "react";
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
 * - Let callers provide a `fallbackJobId` (P-0102 v3-24a): when the URL
 *   carries no param, fall back to a server-derived id (typically
 *   `workspaceStatus.current_job_id`) so a browser reload re-attaches
 *   the Workspace to the previously-running job. Consumed at most once
 *   per mount; the URL remains the source of truth otherwise.
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
  /**
   * Optional server-derived fallback id (P-0102 v3-24a). Consumed only
   * when the URL carries no `?job_id=` param AND no local override has
   * been applied yet. Hydrated at most once per mount so a later
   * `setJobId(null)` does not re-pull the fallback. `suppress` and
   * `filter` apply to the fallback the same way they apply to the URL
   * value, so a freshly-started fit (suppress=true) cannot be
   * back-filled by a stale workspace status.
   */
  fallbackJobId?: string | null;
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
  const { suppress = false, filter, fallbackJobId = null } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobId, setJobIdState] = useState<string | null>(() =>
    readParam(searchParams),
  );

  // INV-reload-3 (P-0102): the fallback is consumed at most once per
  // mount. After the user explicitly clears the id (setJobId(null)) or
  // a fresh fit/tune writes a new value, a later workspaceStatus
  // refetch must not re-hydrate from the now-stale fallback.
  const fallbackConsumedRef = useRef(false);

  // Re-sync state when the URL param changes after mount (e.g. user
  // clicks a "view in Workspace" link while already on the page).
  // `filter` is read directly — storing it in a ref would complicate
  // the API without benefit, and callers already memoize it via
  // `useCallback` when needed.
  useEffect(() => {
    if (suppress) return;
    const candidate = readParam(searchParams);
    if (candidate !== null) {
      if (filter && !filter(candidate)) return;
      setJobIdState(candidate);
      return;
    }
    // URL is empty — try the fallback once. The fallback is async
    // (workspaceStatus arrives after mount), so we keep re-running
    // until either the URL takes over or the fallback fires.
    if (fallbackConsumedRef.current) return;
    if (!fallbackJobId) return;
    if (filter && !filter(fallbackJobId)) return;
    fallbackConsumedRef.current = true;
    setJobIdState(fallbackJobId);
  }, [searchParams, suppress, filter, fallbackJobId]);

  const setJobId = useCallback(
    (next: string | null, opts?: { writeUrl?: boolean }) => {
      // Lock the fallback latch on any explicit user write so a later
      // workspaceStatus refetch cannot re-hydrate after the user
      // intentionally cleared or replaced the id.
      fallbackConsumedRef.current = true;
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
