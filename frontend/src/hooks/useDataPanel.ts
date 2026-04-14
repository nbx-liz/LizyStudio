import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import type { ColumnInfo, ColumnStatsResponse, UiSchema } from "@/api/types";
import {
  fetchColumnStats,
  fetchColumns,
  fetchConfig,
  fetchConfigDefaults,
  fetchPreview,
  loadDataFromPath,
  updateConfig,
  uploadData,
} from "@/api/workspace";
import {
  applyCvDataFields,
  type BlockedGroupKFoldState,
  buildSplitConfig,
  type CvState,
  INITIAL_BLOCKED_STATE,
  INITIAL_CV_STATE,
  recommendedInnerValid,
  resetCvState,
} from "@/components/workspace/CvSection";
import { getDefaultCvStrategy } from "@/components/workspace/constants";

export type SourceType = "path" | "upload";
export type TaskType = "binary" | "multiclass" | "regression";

export const TASK_OPTIONS: TaskType[] = ["binary", "multiclass", "regression"];

export interface ColumnOverride {
  excluded: boolean;
  type: "numeric" | "categorical";
}

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
  const [sourceType, setSourceType] = useState<SourceType>("upload");
  const [dataPath, setDataPath] = useState("");
  const [shape, setShape] = useState<[number, number] | null>(null);
  const [preview, setPreview] = useState<{
    columns: string[];
    data: Record<string, unknown>[];
  } | null>(null);

  const [target, setTarget] = useState<string | null>(null);
  const [task, setTask] = useState<TaskType | null>(null);
  const [allColumnNames, setAllColumnNames] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ColumnOverride>>(
    {},
  );

  const [cv, setCv] = useState<CvState>(INITIAL_CV_STATE);
  const [blocked, setBlocked] = useState<BlockedGroupKFoldState>(
    INITIAL_BLOCKED_STATE,
  );
  const [loading, setLoading] = useState(false);
  const [columnFilter, setColumnFilter] = useState("");
  const [expandedCol, setExpandedCol] = useState<string | null>(null);
  const [colStats, setColStats] = useState<Record<string, ColumnStatsResponse>>(
    {},
  );

  const abortRef = useRef<AbortController | null>(null);
  const prevCvStrategyRef = useRef<string>(cv.strategy);
  // H-0063: handleTargetChange owns the full config PUT for target selection
  // (via fetchConfigDefaults). Setting this ref to true makes the
  // target/task/overrides/cv effect skip one syncConfig run so it does not
  // race ahead with a partial config derived from an empty fetchConfig().
  const skipNextSyncRef = useRef(false);

  const syncConfig = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const categorical = Object.entries(overrides)
        .filter(([, v]) => !v.excluded && v.type === "categorical")
        .map(([k]) => k);
      const excluded = Object.entries(overrides)
        .filter(([, v]) => v.excluded)
        .map(([k]) => k);

      let base = await fetchConfig({ signal: controller.signal });
      if (controller.signal.aborted) return;
      // H-0063: if the server-side config has not been seeded yet (e.g. the
      // user just picked a Task for the first time after loading data), fall
      // back to fetchConfigDefaults so the PUT carries a full validatable
      // config instead of a partial one that fails Pydantic.
      const hasConfigVersion =
        (base as Record<string, unknown>).config_version !== undefined;
      if (!hasConfigVersion && task && target) {
        base = await fetchConfigDefaults(task, target);
      }

      const baseData = (base as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      const merged: Record<string, unknown> = {
        ...base,
        task: task || (base as Record<string, unknown>).task,
        data: applyCvDataFields(
          {
            ...baseData,
            path: dataPath || undefined,
            target: target || undefined,
          },
          cv,
        ),
        features: {
          ...((base as Record<string, unknown>).features as object),
          categorical,
          exclude: excluded,
        },
        split: buildSplitConfig(cv, blocked),
      };
      // Auto-set inner validation method when CV strategy changes
      const baseTraining = (merged.training as Record<string, unknown>) ?? {};
      const innerValid =
        (baseTraining.inner_valid as Record<string, unknown>) ?? {};
      if (prevCvStrategyRef.current !== cv.strategy) {
        const recommended = recommendedInnerValid(cv.strategy);
        merged.training = {
          ...baseTraining,
          inner_valid: { ...innerValid, method: recommended },
        };
        prevCvStrategyRef.current = cv.strategy;
      }
      await updateConfig(merged, { signal: controller.signal });
      if (controller.signal.aborted) return;
      onDataChanged();
    } catch (err) {
      // Aborted requests are expected; only report real errors
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Config sync failed — changes may not be saved");
    }
  }, [dataPath, target, task, overrides, cv, blocked, onDataChanged]);

  const prevSyncKey = useRef("");
  useEffect(() => {
    if (!target) return;
    const key = JSON.stringify({ target, task, overrides, cv, blocked });
    if (key === prevSyncKey.current) return;
    prevSyncKey.current = key;
    // H-0063: suppress syncConfig while handleTargetChange is assembling the
    // full defaults-backed config. The flag stays set until that flow
    // finishes so every intermediate render (setTask, setOverrides, setCv)
    // is skipped, not just the first one after setTarget.
    if (skipNextSyncRef.current) {
      return;
    }
    syncConfig();
  }, [target, task, overrides, cv, blocked, syncConfig]);

  const handleLoadPathByValue = async (path: string) => {
    if (!path.trim()) return;
    setLoading(true);
    try {
      const res = await loadDataFromPath(path);
      setShape(res.data_ref.shape);
      const prev = await fetchPreview(5);
      setPreview(prev);
      const cols = await fetchColumns();
      setColumns(cols.columns);
      setAllColumnNames(cols.columns.map((c) => c.name));
      setTarget(null);
      setTask(null);
      setOverrides({});
      onTaskChanged?.(null);
      onDataChanged();
      toast.success(
        `Data loaded: ${res.data_ref.shape[0]} rows x ${res.data_ref.shape[1]} columns`,
      );
    } catch (err) {
      toast.error(`Failed to load data: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const res = await uploadData(file);
      setShape(res.data_ref.shape);
      setDataPath(res.data_ref.path);
      const prev = await fetchPreview(5);
      setPreview(prev);
      const cols = await fetchColumns();
      setColumns(cols.columns);
      setAllColumnNames(cols.columns.map((c) => c.name));
      setTarget(null);
      setTask(null);
      setOverrides({});
      onTaskChanged?.(null);
      onDataChanged();
      toast.success(`Uploaded: ${file.name}`);
    } catch (err) {
      toast.error(`Upload failed: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTargetChange = useCallback(
    async (value: string) => {
      // H-0063: block the target/task/overrides/cv effect from firing
      // syncConfig while we assemble the full defaults-backed config below.
      // Without this guard, setTarget(value) schedules syncConfig synchronously
      // on the next render, which runs ahead with an empty fetchConfig() and
      // PUTs a partial config that fails Pydantic validation.
      skipNextSyncRef.current = true;
      setTarget(value);
      try {
        const cols = await fetchColumns(value);
        setColumns(cols.columns);

        let detectedTask: TaskType | null = task;
        let detectedStrategy = cv.strategy;
        if (cols.suggested_task) {
          const t = cols.suggested_task as TaskType;
          detectedTask = t;
          setTask(t);
          onTaskChanged?.(t);
          detectedStrategy = getDefaultCvStrategy(t);
          setCv(resetCvState(detectedStrategy));
        }

        const newOverrides: Record<string, ColumnOverride> = {};
        for (const col of cols.columns) {
          newOverrides[col.name] = {
            excluded: col.suggested_excluded,
            type: col.suggested_type,
          };
        }
        setOverrides(newOverrides);

        if (detectedTask) {
          const defaults = await fetchConfigDefaults(detectedTask, value);
          const categorical = Object.entries(newOverrides)
            .filter(([, v]) => !v.excluded && v.type === "categorical")
            .map(([k]) => k);
          const excluded = Object.entries(newOverrides)
            .filter(([, v]) => v.excluded)
            .map(([k]) => k);
          const merged: Record<string, unknown> = {
            ...defaults,
            task: detectedTask,
            data: {
              ...(defaults.data as object),
              path: dataPath || undefined,
              target: value,
            },
            features: {
              ...(defaults.features as object),
              categorical,
              exclude: excluded,
            },
            split: {
              method: detectedStrategy,
              n_splits: cv.folds,
            },
          };
          await updateConfig(merged);
          onDataChanged();
        }
      } catch (err) {
        toast.error(`Column detection failed: ${getErrorMessage(err)}`);
      } finally {
        // H-0063: release the guard so subsequent legitimate state changes
        // (e.g. user toggling include/exclude) can trigger syncConfig again.
        skipNextSyncRef.current = false;
      }
    },
    [task, cv, dataPath, onDataChanged, onTaskChanged],
  );

  const handleTaskChange = (newTask: TaskType) => {
    setTask(newTask);
    onTaskChanged?.(newTask);
    setCv(resetCvState(getDefaultCvStrategy(newTask)));
  };

  const handleExcludeToggle = (colName: string, checked: boolean) => {
    setOverrides((prev) => ({
      ...prev,
      [colName]: { ...prev[colName], excluded: checked },
    }));
  };

  const handleTypeChange = (
    colName: string,
    type: "numeric" | "categorical",
  ) => {
    setOverrides((prev) => ({
      ...prev,
      [colName]: { ...prev[colName], type },
    }));
  };

  const handleColumnExpand = useCallback(
    async (colName: string) => {
      if (expandedCol === colName) {
        setExpandedCol(null);
        return;
      }
      setExpandedCol(colName);
      if (!colStats[colName]) {
        try {
          const stats = await fetchColumnStats(colName);
          setColStats((prev) => ({ ...prev, [colName]: stats }));
        } catch {
          // Silently fail — bar just won't show
        }
      }
    },
    [expandedCol, colStats],
  );

  const summary = useMemo(() => {
    const nonTarget = columns.filter((c) => c.name !== target);
    const total = nonTarget.length;
    const excludedCols = nonTarget.filter((c) => overrides[c.name]?.excluded);
    const included = nonTarget.filter((c) => !overrides[c.name]?.excluded);
    const numeric = included.filter(
      (c) => (overrides[c.name]?.type ?? c.suggested_type) === "numeric",
    );
    const categorical = included.filter(
      (c) => (overrides[c.name]?.type ?? c.suggested_type) === "categorical",
    );
    const idCount = excludedCols.filter(
      (c) => columns.find((cc) => cc.name === c.name)?.exclude_reason === "id",
    ).length;
    const constCount = excludedCols.filter(
      (c) =>
        columns.find((cc) => cc.name === c.name)?.exclude_reason === "constant",
    ).length;
    const manualCount = excludedCols.length - idCount - constCount;
    return {
      total,
      numeric: numeric.length,
      categorical: categorical.length,
      excluded: excludedCols.length,
      idCount,
      constCount,
      manualCount,
    };
  }, [columns, overrides, target]);

  const nonExcludedCols = columns.filter(
    (c) => c.name !== target && !overrides[c.name]?.excluded,
  );

  return {
    sourceType,
    setSourceType,
    dataPath,
    setDataPath,
    shape,
    preview,
    target,
    task,
    allColumnNames,
    columns,
    overrides,
    cv,
    setCv,
    blocked,
    setBlocked,
    loading,
    columnFilter,
    setColumnFilter,
    expandedCol,
    colStats,
    summary,
    nonExcludedCols,
    handleLoadPathByValue,
    handleUpload,
    handleTargetChange,
    handleTaskChange,
    handleExcludeToggle,
    handleTypeChange,
    handleColumnExpand,
  };
}
