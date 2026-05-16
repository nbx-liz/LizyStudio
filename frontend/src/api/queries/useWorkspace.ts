/**
 * Workspace-config family queries. ``useModelPanelData`` already
 * composes these, so inline duplicates in WorkspacePage get the same
 * cache entry.
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchBackends,
  fetchColumns,
  fetchConfig,
  fetchConfigSchema,
  fetchTuningSnapshot,
  fetchUiSchema,
  fetchWorkspaceStatus,
} from "@/api/workspace";
import { queryKeys } from "../queryKeys";

const INFINITE_STALE_TIME = Number.POSITIVE_INFINITY;

export function useConfig(options?: { enabled?: boolean; retry?: boolean }) {
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: fetchConfig,
    enabled: options?.enabled !== false,
    retry: options?.retry,
  });
}

export function useConfigSchema() {
  return useQuery({
    queryKey: queryKeys.configSchema(),
    queryFn: fetchConfigSchema,
    staleTime: INFINITE_STALE_TIME,
  });
}

export function useUiSchema() {
  return useQuery({
    queryKey: queryKeys.uiSchema(),
    queryFn: fetchUiSchema,
    staleTime: INFINITE_STALE_TIME,
  });
}

export function useBackends() {
  return useQuery({
    queryKey: queryKeys.backends(),
    queryFn: fetchBackends,
    staleTime: INFINITE_STALE_TIME,
  });
}

export function useColumns(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.columns(),
    queryFn: () => fetchColumns(),
    enabled: options?.enabled !== false,
  });
}

/**
 * Issue #363: WorkspacePage uses this on mount to discover whether
 * the server already holds data + config from a previous session, so
 * the UI can rehydrate instead of forcing the user to re-enter the
 * CSV path on every reload.
 */
export function useWorkspaceStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.workspaceStatus(),
    queryFn: fetchWorkspaceStatus,
    enabled: options?.enabled !== false,
    retry: false,
  });
}

/**
 * P-0109 PR-6c: Tune-tab snapshot subscription.
 *
 * Exposes the backend's intent / effective / defaults triple in one
 * payload so the Tune tab can:
 *
 *   1. Read ``tuning_defaults.evaluation_metrics`` as the canonical
 *      fallback for the Optimization / Additional Metrics widgets —
 *      replaces the frontend-only ``TASK_DEFAULT_METRICS`` constant
 *      that was deferred from PR-5.
 *   2. Render the per-row "modified" badge on SearchSpaceRow from
 *      ``tuning_effective.user_set_paths`` — entries the user
 *      explicitly touched (catalog defaults stay un-badged).
 *
 * Disabled until a task is set: a fresh workspace returns empty
 * defaults, and forcing the query to run before the user picks a task
 * pollutes the cache with a transient empty result that ``setQueryData``
 * would need to clobber. Pass ``enabled: !!task`` from the caller.
 */
export function useTuningSnapshot(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.tuningSnapshot(),
    queryFn: ({ signal }) => fetchTuningSnapshot({ signal }),
    enabled: options?.enabled !== false,
  });
}
