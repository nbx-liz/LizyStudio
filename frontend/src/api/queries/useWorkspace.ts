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
