import { useCallback, useState } from "react";
import type { ColumnInfo, UiSchema } from "@/api/types";
import {
  type BlockedGroupKFoldState,
  INITIAL_BLOCKED_STATE,
} from "@/components/workspace/BlockedGroupKFoldEditor";
import {
  type CvState,
  getEffectiveCvStrategy,
  INITIAL_CV_STATE,
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
