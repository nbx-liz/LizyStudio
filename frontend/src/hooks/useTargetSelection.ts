import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import { queryKeys } from "@/api/queryKeys";
import type { ColumnInfo, UiSchema } from "@/api/types";
import {
  fetchColumns,
  fetchConfigDefaults,
  updateConfig,
} from "@/api/workspace";
import type { BlockedGroupKFoldState } from "@/components/workspace/BlockedGroupKFoldEditor";
import {
  type CvState,
  getEffectiveCvStrategy,
  resetCvState,
} from "@/components/workspace/cv-state";
import {
  buildMergedConfig,
  buildOverridesFromColumns,
  buildSyncKey,
  type ColumnOverride,
  type TaskType,
} from "./useDataPanel.types";

/**
 * B-5 (H-0077): the target-selection mutation extracted from
 * {@link useDataPanel} so the top-level orchestration hook stays lean.
 *
 * The function mutates four React state cells (target, task, columns,
 * cv) plus two sibling-hook registries (column overrides, config sync).
 * All of those are threaded in as params so this hook holds no state of
 * its own — it is just the combined side-effect chain of "user picked a
 * new target column".
 */
interface UseTargetSelectionParams {
  task: TaskType | null;
  cv: CvState;
  blocked: BlockedGroupKFoldState;
  dataPath: string;
  uiSchema?: UiSchema;
  setTarget: (value: string) => void;
  setTask: (task: TaskType) => void;
  setCv: (cv: CvState) => void;
  setColumns: (columns: ColumnInfo[]) => void;
  setOverrides: (overrides: Record<string, ColumnOverride>) => void;
  setSyncSuppressed: (flag: boolean) => void;
  preseedSyncKey: (key: string) => void;
  onDataChanged: () => void;
  onTaskChanged?: (task: string | null) => void;
}

export function useTargetSelection({
  task,
  cv,
  blocked,
  dataPath,
  uiSchema,
  setTarget,
  setTask,
  setCv,
  setColumns,
  setOverrides,
  setSyncSuppressed,
  preseedSyncKey,
  onDataChanged,
  onTaskChanged,
}: UseTargetSelectionParams) {
  const queryClient = useQueryClient();

  const handleTargetChange = useCallback(
    async (value: string) => {
      setSyncSuppressed(true);
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
          detectedStrategy = getEffectiveCvStrategy(t, uiSchema);
          nextCv = resetCvState(detectedStrategy);
          setCv(nextCv);
        }

        const newOverrides = buildOverridesFromColumns(cols.columns);
        setOverrides(newOverrides);

        if (detectedTask) {
          const defaults = await fetchConfigDefaults(detectedTask, value);
          const merged = buildMergedConfig({
            defaults,
            task: detectedTask,
            strategy: detectedStrategy,
            // Use nextCv.folds (post-reset) so the merged split config
            // matches the cv state the sync effect will observe next;
            // otherwise the pre-reset cv.folds could leak into the PUT
            // while preseedSyncKey uses nextCv.
            folds: nextCv.folds,
            dataPath,
            target: value,
            overrides: newOverrides,
          });
          await updateConfig(merged);
          queryClient.setQueryData(queryKeys.config(), merged);
          preseedSyncKey(
            buildSyncKey(value, detectedTask, newOverrides, nextCv, blocked),
          );
          onDataChanged();
        }
      } catch (err) {
        toast.error(`Column detection failed: ${getErrorMessage(err)}`);
      } finally {
        setSyncSuppressed(false);
        // Radix Select returns focus to the trigger on close via
        // `onCloseAutoFocus`, which runs AFTER our finally block. Defer
        // the blur to the next animation frame so it fires after Radix
        // has restored focus, otherwise `:focus-visible` matches and the
        // 3px focus ring combined with the 1px border reads as a doubled
        // outline. Keyboard users regain the ring on subsequent Tab.
        requestAnimationFrame(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
      }
    },
    [
      task,
      cv,
      blocked,
      dataPath,
      uiSchema,
      onDataChanged,
      onTaskChanged,
      queryClient,
      setTarget,
      setTask,
      setCv,
      setColumns,
      setOverrides,
      setSyncSuppressed,
      preseedSyncKey,
    ],
  );

  return { handleTargetChange };
}
