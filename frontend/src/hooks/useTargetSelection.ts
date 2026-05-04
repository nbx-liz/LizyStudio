import { useCallback } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import type { ColumnInfo, UiSchema } from "@/api/types";
import { fetchColumns, fetchConfigDefaults } from "@/api/workspace";
import type { BlockedGroupKFoldState } from "@/components/workspace/BlockedGroupKFoldEditor";
import {
  type CvState,
  getEffectiveCvStrategy,
  resetCvState,
} from "@/components/workspace/cv-state";
import type { ConfigWriteFunnel } from "./useConfigWriteFunnel";
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
  /**
   * P-0092 Q-1 Phase 3: write funnel injected by `useDataPanel`. When
   * provided, the merged-config PUT goes through `enqueueWrite` so the
   * target-select operation serialises behind any in-flight cv-change
   * or auto-reset writers. When `null` (test paths that render the
   * hook without a Provider), falls back to the legacy direct
   * `updateConfig` + `setQueryData` pair via `legacyUpdateConfig`.
   */
  writeFunnel?: ConfigWriteFunnel | null;
  /**
   * Legacy code path used only when `writeFunnel` is not supplied.
   * Tests inject a stubbed pair to assert the merged config that
   * would have been PUT.
   */
  legacyUpdateConfig?: {
    putConfig: (body: Record<string, unknown>) => Promise<unknown>;
    setQueryData: (config: Record<string, unknown>) => void;
  };
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
  writeFunnel,
  legacyUpdateConfig,
}: UseTargetSelectionParams) {
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
          // P-0092 Phase 3: route the merged-config PUT through the
          // write funnel when one is wired. The funnel's
          // `onWriteCommitted` writes the saved snapshot to the
          // React Query cache, so the legacy `setQueryData` is no
          // longer needed in that path. Test paths that mount the
          // hook without a Provider keep using `legacyUpdateConfig`
          // — the seam exists for the exact reason the funnel does:
          // we want to migrate this writer without breaking unit
          // tests that drive it directly.
          if (writeFunnel) {
            await writeFunnel.enqueueWrite({
              kind: "replace",
              config: merged,
              reason: "target-select",
            });
          } else if (legacyUpdateConfig) {
            await legacyUpdateConfig.putConfig(merged);
            legacyUpdateConfig.setQueryData(merged);
          } else {
            // No writer wired — surface clearly instead of silently
            // dropping the user's target pick.
            throw new Error(
              "useTargetSelection: neither writeFunnel nor legacyUpdateConfig was provided",
            );
          }
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
      setTarget,
      setTask,
      setCv,
      setColumns,
      setOverrides,
      setSyncSuppressed,
      preseedSyncKey,
      writeFunnel,
      legacyUpdateConfig,
    ],
  );

  return { handleTargetChange };
}
