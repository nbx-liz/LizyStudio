import type { BlockedGroupKFoldState } from "@/components/workspace/BlockedGroupKFoldEditor";
import {
  applyCvDataFields,
  buildSplitConfig,
  type CvState,
} from "@/components/workspace/cv-state";
import type { ColumnOverride, TaskType } from "./useDataPanel.types";
import { extractOverrideArrays } from "./useDataPanel.types";

/**
 * Pure builder that merges the latest UI state onto a base config snapshot.
 *
 * Extracted from ``useConfigSync.syncConfig`` (P-0086, Issue #251) so the
 * same logic can be reused by the Fit / Tune handlers to send the current
 * state in the POST body. Without sharing this, the UI would have to either
 * (a) wait for the in-flight PUT /config — race-prone and brittle — or
 * (b) duplicate the merging logic and drift out of sync with what
 * ``useConfigSync`` emits.
 *
 * The CV-strategy-change ``inner_valid`` auto-switch stays inside the hook
 * because it depends on a cross-render ref; this builder is intentionally
 * stateless so it is safe to call from any React event handler.
 */
export function buildSyncedConfig(params: {
  base: Record<string, unknown>;
  dataPath: string;
  target: string | null;
  task: TaskType | null;
  overrides: Record<string, ColumnOverride>;
  cv: CvState;
  blocked: BlockedGroupKFoldState;
  strategyFields?: readonly string[];
}): Record<string, unknown> {
  const {
    base,
    dataPath,
    target,
    task,
    overrides,
    cv,
    blocked,
    strategyFields,
  } = params;
  const { categorical, excluded } = extractOverrideArrays(overrides);
  const baseData = (base.data as Record<string, unknown>) ?? {};
  const baseTask = (base as Record<string, unknown>).task;
  const effectiveTask = task || baseTask;
  // Issue #272: when the task changes (e.g. user clicked a different
  // Task radio), the inherited base config still carries the previous
  // task's ``model.params.objective`` and ``model.params.metric``. The
  // backend ``task_params_compat_errors`` validator rejects the PUT
  // with ``saved=false`` because objective='binary' is not allowed for
  // task='regression'. The PUT looks 200-OK but the server silently
  // keeps the previous task — which is exactly the silent UI/config
  // divergence #272 reports. Drop those task-coupled fields here so
  // the PUT lands cleanly; ConfigForm's auto-select effect repopulates
  // defaults on the next render.
  const baseModel = (base.model as Record<string, unknown>) ?? {};
  const baseModelParams = (baseModel.params as Record<string, unknown>) ?? {};
  const taskChanged =
    typeof baseTask === "string" &&
    typeof effectiveTask === "string" &&
    baseTask !== effectiveTask;
  let mergedModel = baseModel;
  if (taskChanged) {
    const {
      objective: _objective,
      metric: _metric,
      ...restParams
    } = baseModelParams;
    mergedModel = { ...baseModel, params: restParams };
  }
  // Issue #272 (cont.): calibration is binary-only on lizyml. Switching
  // away from binary leaves a stale calibration object that PR #271
  // had ConfigForm auto-clear via a separate effect — but that effect
  // can race against this PUT. Drop it here so the same write that
  // changes ``task`` also drops the now-invalid calibration. The
  // backend ``task_calibration_mismatch`` rule would otherwise fail
  // saved=false the same way as the objective mismatch above.
  const calibrationOut =
    taskChanged && effectiveTask !== "binary"
      ? null
      : ((base as Record<string, unknown>).calibration ?? null);
  return {
    ...base,
    task: effectiveTask,
    data: applyCvDataFields(
      {
        ...baseData,
        path: dataPath || undefined,
        target: target || undefined,
      },
      cv,
      strategyFields,
    ),
    features: {
      ...((base.features as object) ?? {}),
      categorical,
      exclude: excluded,
    },
    split: buildSplitConfig(cv, blocked, strategyFields),
    model: mergedModel,
    calibration: calibrationOut,
  };
}
