import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { queryKeys } from "@/api/queryKeys";
import type { ColumnInfo, UiSchema } from "@/api/types";
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

  const { handleTargetChange } = useTargetSelection({
    task,
    cv,
    blocked,
    dataPath: dataLoad.dataPath,
    uiSchema,
    setTarget,
    setTask,
    setCv,
    setColumns,
    setOverrides: columnOverrides.setOverrides,
    setSyncSuppressed: configSync.setSyncSuppressed,
    preseedSyncKey: configSync.preseedSyncKey,
    onDataChanged,
    onTaskChanged,
  });

  const handleTaskChange = useCallback(
    (newTask: TaskType) => {
      setTask(newTask);
      onTaskChanged?.(newTask);
      setCv(resetCvState(getEffectiveCvStrategy(newTask, uiSchema)));
    },
    [onTaskChanged, uiSchema],
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
  const queryClient = useQueryClient();
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
    overrides: columnOverrides.overrides,
    cv,
    setCv,
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
    handleColumnExpand: columnOverrides.handleColumnExpand,
  };
}
