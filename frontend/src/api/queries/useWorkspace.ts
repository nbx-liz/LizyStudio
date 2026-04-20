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
