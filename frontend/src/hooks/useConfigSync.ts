import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  fetchConfig,
  fetchConfigDefaults,
  updateConfig,
} from "@/api/workspace";
import {
  applyCvDataFields,
  type BlockedGroupKFoldState,
  buildSplitConfig,
  type CvState,
  recommendedInnerValid,
} from "@/components/workspace/CvSection";
import type { ColumnOverride, TaskType } from "./useDataPanel.types";
import { buildSyncKey, extractOverrideArrays } from "./useDataPanel.types";

interface UseConfigSyncParams {
  dataPath: string;
  target: string | null;
  task: TaskType | null;
  overrides: Record<string, ColumnOverride>;
  cv: CvState;
  blocked: BlockedGroupKFoldState;
  onDataChanged: () => void;
}

export function useConfigSync({
  dataPath,
  target,
  task,
  overrides,
  cv,
  blocked,
  onDataChanged,
}: UseConfigSyncParams) {
  const abortRef = useRef<AbortController | null>(null);
  const prevCvStrategyRef = useRef<string>(cv.strategy);
  const skipNextSyncRef = useRef(false);
  const prevSyncKey = useRef("");

  const syncConfig = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { categorical, excluded } = extractOverrideArrays(overrides);

      let base = await fetchConfig({ signal: controller.signal });
      if (controller.signal.aborted) return;

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
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Config sync failed — changes may not be saved");
    }
  }, [dataPath, target, task, overrides, cv, blocked, onDataChanged]);

  useEffect(() => {
    if (!target) return;
    const key = buildSyncKey(target, task, overrides, cv, blocked);
    if (key === prevSyncKey.current) return;
    prevSyncKey.current = key;
    if (skipNextSyncRef.current) {
      return;
    }
    syncConfig();
  }, [target, task, overrides, cv, blocked, syncConfig]);

  const setSyncSuppressed = useCallback((flag: boolean) => {
    skipNextSyncRef.current = flag;
  }, []);

  const preseedSyncKey = useCallback((key: string) => {
    prevSyncKey.current = key;
  }, []);

  return {
    syncConfig,
    setSyncSuppressed,
    preseedSyncKey,
  };
}
