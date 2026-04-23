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
  return {
    ...base,
    task: task || baseTask,
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
  };
}
