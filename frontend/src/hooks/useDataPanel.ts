import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { queryKeys } from "@/api/queryKeys";
import type { ColumnInfo, UiSchema } from "@/api/types";
import { updateConfig } from "@/api/workspace";
import {
  type BlockedGroupKFoldState,
  INITIAL_BLOCKED_STATE,
} from "@/components/workspace/BlockedGroupKFoldEditor";
import {
  type CvState,
  getEffectiveCvStrategy,
  INITIAL_CV_STATE,
  parseSplitToCv,
  resetCvState,
} from "@/components/workspace/cv-state";
import { useColumnOverrides } from "./useColumnOverrides";
import { useConfigSync } from "./useConfigSync";
import { useConfigWriteFunnelOptional } from "./useConfigWriteFunnelContext";
import { useDataLoad } from "./useDataLoad";
import {
  buildMergedConfig,
  buildOverridesFromColumns,
  type ColumnOverride,
  type SourceType,
  TASK_OPTIONS,
  type TaskType,
} from "./useDataPanel.types";
import { useTargetSelection } from "./useTargetSelection";

export type { ColumnOverride, SourceType, TaskType };
export { buildMergedConfig, buildOverridesFromColumns, TASK_OPTIONS };

interface UseDataPanelParams {
  onDataChanged: () => void;
  onTaskChanged?: (task: string | null) => void;
  uiSchema?: UiSchema;
}

export function useDataPanel({
  onDataChanged,
  onTaskChanged,
  uiSchema,
}: UseDataPanelParams) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const [task, setTask] = useState<TaskType | null>(null);
  const [allColumnNames, setAllColumnNames] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [cv, setCv] = useState<CvState>(INITIAL_CV_STATE);
  const [blocked, setBlocked] = useState<BlockedGroupKFoldState>(
    INITIAL_BLOCKED_STATE,
  );

  const columnOverrides = useColumnOverrides({ columns, target });

  const onColumnsLoaded = useCallback(
    (cols: ColumnInfo[], allNames: string[]) => {
      setColumns(cols);
      setAllColumnNames(allNames);
    },
    [],
  );

  const onReset = useCallback(() => {
    setTarget(null);
    setTask(null);
    columnOverrides.setOverrides({});
  }, [columnOverrides.setOverrides]);

  const dataLoad = useDataLoad({
    onDataChanged,
    onTaskChanged,
    onColumnsLoaded,
    onReset,
  });

  const configSync = useConfigSync({
    dataPath: dataLoad.dataPath,
    target,
    task,
    overrides: columnOverrides.overrides,
    cv,
    blocked,
    uiSchema,
    onDataChanged,
  });

  // P-0092 Phase 3: pull the optional write funnel from the
  // Workspace-level provider. When mounted, target-select PUTs go
  // through it; otherwise the legacy direct PUT + setQueryData
  // path keeps working for any caller that renders the hook outside
  // a provider (test paths, the few story setups).
  const writeFunnel = useConfigWriteFunnelOptional();

  // Issue #358: latch the strategy the user just picked so a stale
  // cache update (cache subscriber firing while the user-driven PUT
  // is still in flight) cannot revert it. Cleared once the cache
  // catches up to the latched value, after which legitimate external
  // writes (Load Preset, undo/redo) resume their normal back-sync.
  //
  // The latch also auto-expires after ``LATCH_TTL_MS`` so that a
  // backend rejection (PUT returns ``saved=false`` and the cache
  // never catches up) doesn't permanently lock out subsequent
  // external writes such as Load Preset. The TTL is comfortably
  // larger than the worst-case in-flight PUT (~500 ms) and small
  // enough that a user perceives no UI lag if they trigger Load
  // Preset right after a failed user-driven CV change.
  const LATCH_TTL_MS = 2000;
  const lastUserStrategyRef = useRef<string | null>(null);
  const latchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCvFromUser = useCallback((nextCv: CvState) => {
    lastUserStrategyRef.current = nextCv.strategy;
    if (latchTimeoutRef.current !== null) {
      clearTimeout(latchTimeoutRef.current);
    }
    latchTimeoutRef.current = setTimeout(() => {
      // Only clear if the latched strategy is still ours — a later
      // ``setCvFromUser`` that swapped the latch will run its own
      // timeout and own the clear.
      if (lastUserStrategyRef.current === nextCv.strategy) {
        lastUserStrategyRef.current = null;
      }
      latchTimeoutRef.current = null;
    }, LATCH_TTL_MS);
    setCv(nextCv);
  }, []);
  useEffect(() => {
    return () => {
      if (latchTimeoutRef.current !== null) {
        clearTimeout(latchTimeoutRef.current);
      }
    };
  }, []);

  const { handleTargetChange } = useTargetSelection({
    task,
    cv,
    blocked,
    dataPath: dataLoad.dataPath,
    uiSchema,
    setTarget,
    setTask,
    // Issue #358: target-select also resets cv via the suggested-task
    // path; route it through the user-driven setter so the latch is
    // marked and any stale cache update during the in-flight PUT is
    // ignored.
    setCv: setCvFromUser,
    setColumns,
    setOverrides: columnOverrides.setOverrides,
    setSyncSuppressed: configSync.setSyncSuppressed,
    preseedSyncKey: configSync.preseedSyncKey,
    onDataChanged,
    onTaskChanged,
    writeFunnel,
    legacyUpdateConfig: writeFunnel
      ? undefined
      : {
          putConfig: updateConfig,
          setQueryData: (config) =>
            queryClient.setQueryData(queryKeys.config(), config),
        },
  });

  const handleTaskChange = useCallback(
    (newTask: TaskType) => {
      setTask(newTask);
      onTaskChanged?.(newTask);
      setCvFromUser(resetCvState(getEffectiveCvStrategy(newTask, uiSchema)));
    },
    [onTaskChanged, uiSchema, setCvFromUser],
  );

  // P-0090 / Issue #278 residual: subscribe to the cached config and
  // back-sync local cv/blocked state whenever an external write
  // (handleLoadPreset, undo/redo, useConfigSync's new setQueryData
  // path) drops a different value into the cache. Without this the
  // controlled inputs in CvSection stay pinned to the pre-external-
  // write snapshot and only resync on a full page reload.
  //
  // The subscription is via QueryCache.subscribe() so we observe
  // updates without triggering a fetch (the cache is read-only here).
  // A signature ref guards against the obvious feedback loop where
  // useConfigSync's PUT-then-setQueryData echoes back into setCv —
  // we only call setCv when the parsed split actually differs from
  // current local state.
  const cvRef = useRef(cv);
  cvRef.current = cv;
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const reconcile = () => {
      const cached = queryClient.getQueryData<Record<string, unknown>>(
        queryKeys.config(),
      );
      if (!cached) return;
      const split = cached.split as Record<string, unknown> | undefined;
      const data = cached.data as Record<string, unknown> | undefined;
      const parsed = parseSplitToCv(split, data);
      if (Object.keys(parsed).length === 0) return;
      // Issue #358: bail when the cache disagrees with the user's
      // just-applied strategy. The latch holds until the cache catches
      // up, at which point we clear it and resume normal back-sync.
      if (
        lastUserStrategyRef.current !== null &&
        typeof parsed.strategy === "string" &&
        parsed.strategy !== lastUserStrategyRef.current
      ) {
        return;
      }
      if (
        lastUserStrategyRef.current !== null &&
        parsed.strategy === lastUserStrategyRef.current
      ) {
        lastUserStrategyRef.current = null;
      }
      const current = cvRef.current as unknown as Record<string, unknown>;
      // Only update fields that actually differ — bail if everything
      // matches so we never trigger an unnecessary render.
      let changed = false;
      const next: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(parsed)) {
        if (current[k] !== v) {
          next[k] = v;
          changed = true;
        }
      }
      if (changed) setCv(next as unknown as CvState);
    };
    // Initial reconcile in case the cache is already populated when
    // this effect mounts (e.g. after Load Preset in another panel).
    reconcile();
    const unsubscribe = cache.subscribe((event) => {
      if (event.type === "updated" && event.query.queryKey[0] === "config") {
        reconcile();
      }
    });
    return unsubscribe;
  }, [queryClient]);

  /**
   * Issue #363: rehydrate Data Panel state from a server-persisted
   * Workspace snapshot. Called once on mount when the server reports
   * ``has_data === true`` so the UI doesn't force the user to re-enter
   * the CSV path on every browser reload. ``data_ref.shape`` comes
   * from /api/workspace/status; the path / target / task come from
   * the cached /api/workspace/config response.
   */
  const hydrateFromServer = useCallback(
    async (params: {
      path: string;
      shape: [number, number];
      target: string | null;
      task: TaskType | null;
    }) => {
      await dataLoad.hydrateFromServer(
        params.path,
        params.shape,
        params.target,
      );
      setTarget(params.target);
      setTask(params.task);
      onTaskChanged?.(params.task);
    },
    [dataLoad, onTaskChanged],
  );

  return {
    sourceType: dataLoad.sourceType,
    setSourceType: dataLoad.setSourceType,
    dataPath: dataLoad.dataPath,
    setDataPath: dataLoad.setDataPath,
    shape: dataLoad.shape,
    preview: dataLoad.preview,
    target,
    task,
    allColumnNames,
    columns,
    hydrateFromServer,
    overrides: columnOverrides.overrides,
    cv,
    setCv,
    setCvFromUser,
    blocked,
    setBlocked,
    loading: dataLoad.loading,
    columnFilter: columnOverrides.columnFilter,
    setColumnFilter: columnOverrides.setColumnFilter,
    expandedCol: columnOverrides.expandedCol,
    colStats: columnOverrides.colStats,
    summary: columnOverrides.summary,
    nonExcludedCols: columnOverrides.nonExcludedCols,
    handleLoadPathByValue: dataLoad.handleLoadPathByValue,
    handleUpload: dataLoad.handleUpload,
    handleTargetChange,
    handleTaskChange,
    handleExcludeToggle: columnOverrides.handleExcludeToggle,
    handleTypeChange: columnOverrides.handleTypeChange,
    handleBulkExcludeToggle: columnOverrides.handleBulkExcludeToggle,
    handleBulkTypeChange: columnOverrides.handleBulkTypeChange,
    handleColumnExpand: columnOverrides.handleColumnExpand,
  };
}
