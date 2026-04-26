import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UiSchema } from "@/api/types";
import {
  fetchConfig,
  fetchConfigDefaults,
  updateConfig,
} from "@/api/workspace";
import type { BlockedGroupKFoldState } from "@/components/workspace/BlockedGroupKFoldEditor";
import {
  type CvState,
  recommendedInnerValid,
} from "@/components/workspace/cv-state";
import { buildSyncedConfig } from "./buildSyncedConfig";
import type { ColumnOverride, TaskType } from "./useDataPanel.types";
import { buildSyncKey } from "./useDataPanel.types";

interface UseConfigSyncParams {
  dataPath: string;
  target: string | null;
  task: TaskType | null;
  overrides: Record<string, ColumnOverride>;
  cv: CvState;
  blocked: BlockedGroupKFoldState;
  uiSchema?: UiSchema;
  onDataChanged: () => void;
}

export function useConfigSync({
  dataPath,
  target,
  task,
  overrides,
  cv,
  blocked,
  uiSchema,
  onDataChanged,
}: UseConfigSyncParams) {
  const abortRef = useRef<AbortController | null>(null);
  const prevCvStrategyRef = useRef<string>(cv.strategy);
  const skipNextSyncRef = useRef(false);
  const prevSyncKey = useRef("");

  // H-0076: field list comes from the backend UiSchema. ``undefined``
  // falls through to the legacy "emit whatever CvState provides" path.
  const strategyFields = uiSchema?.capabilities?.cv_strategy_fields?.[
    cv.strategy
  ] as readonly string[] | undefined;

  const syncConfig = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let base = await fetchConfig({ signal: controller.signal });
      if (controller.signal.aborted) return;

      const hasConfigVersion =
        (base as Record<string, unknown>).config_version !== undefined;
      if (!hasConfigVersion && task && target) {
        base = await fetchConfigDefaults(task, target);
      }

      const merged = buildSyncedConfig({
        base: base as Record<string, unknown>,
        dataPath,
        target,
        task,
        overrides,
        cv,
        blocked,
        strategyFields,
      });

      // Issue #272 (root cause): the cv-strategy-change inner_valid
      // auto-switch was writing to ``training.inner_valid`` (top-level).
      // The Pydantic schema accepts inner_valid at
      // ``training.early_stopping.inner_valid`` only, so the PUT
      // returned ``saved=false`` with "Extra inputs are not permitted".
      // The user's task change therefore never landed even though
      // useConfigSync emitted the correct ``task`` field — the whole
      // body was rejected. Move the inner_valid mutation under
      // ``early_stopping`` so the PUT lands cleanly.
      const baseTraining = (merged.training as Record<string, unknown>) ?? {};
      const baseEarlyStopping =
        (baseTraining.early_stopping as Record<string, unknown>) ?? {};
      const innerValid =
        (baseEarlyStopping.inner_valid as Record<string, unknown>) ?? {};
      if (prevCvStrategyRef.current !== cv.strategy) {
        const recommended = recommendedInnerValid(cv.strategy);
        merged.training = {
          ...baseTraining,
          early_stopping: {
            ...baseEarlyStopping,
            inner_valid: { ...innerValid, method: recommended },
          },
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
  }, [
    dataPath,
    target,
    task,
    overrides,
    cv,
    blocked,
    strategyFields,
    onDataChanged,
  ]);

  // H-0076: key suffix that makes the dedup guard resync when
  // UiSchema's ``cv_strategy_fields`` resolves after the initial
  // render. Without this, the first post-load sync would be skipped
  // because ``buildSyncKey`` alone has not changed, leaving the last
  // PUT based on the pre-UiSchema fallback.
  const fieldsKeyFragment = `|fields=${JSON.stringify(strategyFields ?? null)}`;

  useEffect(() => {
    if (!target) return;
    const key =
      buildSyncKey(target, task, overrides, cv, blocked) + fieldsKeyFragment;
    if (key === prevSyncKey.current) return;
    prevSyncKey.current = key;
    if (skipNextSyncRef.current) {
      return;
    }
    syncConfig();
  }, [target, task, overrides, cv, blocked, fieldsKeyFragment, syncConfig]);

  const setSyncSuppressed = useCallback((flag: boolean) => {
    skipNextSyncRef.current = flag;
  }, []);

  const preseedSyncKey = useCallback(
    (key: string) => {
      // Apply the same fields suffix the useEffect above uses so the
      // preseeded key matches the key the dedup guard will compute on
      // the next render. Without this, a caller that preseeds with
      // ``buildSyncKey(...)`` sees the next render re-fire the sync
      // because of the mismatching suffix.
      prevSyncKey.current = key + fieldsKeyFragment;
    },
    [fieldsKeyFragment],
  );

  return {
    syncConfig,
    setSyncSuppressed,
    preseedSyncKey,
  };
}
