import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import type { ColumnInfo, UiSchema } from "@/api/types";
import {
  fetchColumns,
  fetchConfigDefaults,
  updateConfig,
} from "@/api/workspace";
import {
  type BlockedGroupKFoldState,
  type CvState,
  INITIAL_BLOCKED_STATE,
  INITIAL_CV_STATE,
  resetCvState,
} from "@/components/workspace/CvSection";
import { getDefaultCvStrategy } from "@/components/workspace/constants";
import { useColumnOverrides } from "./useColumnOverrides";
import { useConfigSync } from "./useConfigSync";
import { useDataLoad } from "./useDataLoad";
import {
  buildMergedConfig,
  buildOverridesFromColumns,
  buildSyncKey,
  type ColumnOverride,
  type SourceType,
  TASK_OPTIONS,
  type TaskType,
} from "./useDataPanel.types";

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
  uiSchema: _uiSchema,
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
    onDataChanged,
  });

  const handleTargetChange = useCallback(
    async (value: string) => {
      await configSync.suppressSync(async () => {
        setTarget(value);
        try {
          const cols = await fetchColumns(value);
          setColumns(cols.columns);

          let detectedTask: TaskType | null = task;
          let detectedStrategy = cv.strategy;
          let nextCv = cv;
          if (cols.suggested_task) {
            const t = cols.suggested_task as TaskType;
            detectedTask = t;
            setTask(t);
            onTaskChanged?.(t);
            detectedStrategy = getDefaultCvStrategy(t);
            nextCv = resetCvState(detectedStrategy);
            setCv(nextCv);
          }

          const newOverrides = buildOverridesFromColumns(cols.columns);
          columnOverrides.setOverrides(newOverrides);

          if (detectedTask) {
            const defaults = await fetchConfigDefaults(detectedTask, value);
            const merged = buildMergedConfig({
              defaults,
              task: detectedTask,
              strategy: detectedStrategy,
              folds: cv.folds,
              dataPath: dataLoad.dataPath,
              target: value,
              overrides: newOverrides,
            });
            await updateConfig(merged);
            queryClient.setQueryData(["config"], merged);
            configSync.preseedSyncKey(
              buildSyncKey(value, detectedTask, newOverrides, nextCv, blocked),
            );
            onDataChanged();
          }
        } catch (err) {
          toast.error(`Column detection failed: ${getErrorMessage(err)}`);
        }
      });
    },
    [
      task,
      cv,
      dataLoad.dataPath,
      blocked,
      onDataChanged,
      onTaskChanged,
      queryClient,
      columnOverrides.setOverrides,
      configSync.suppressSync,
      configSync.preseedSyncKey,
    ],
  );

  const handleTaskChange = (newTask: TaskType) => {
    setTask(newTask);
    onTaskChanged?.(newTask);
    setCv(resetCvState(getDefaultCvStrategy(newTask)));
  };

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
