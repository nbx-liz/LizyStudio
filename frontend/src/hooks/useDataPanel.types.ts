import type { ColumnInfo } from "@/api/types";

export type SourceType = "path" | "upload";
export type TaskType = "binary" | "multiclass" | "regression";

export const TASK_OPTIONS: TaskType[] = ["binary", "multiclass", "regression"];

export interface ColumnOverride {
  excluded: boolean;
  type: "numeric" | "categorical";
}

export function buildOverridesFromColumns(
  columns: ColumnInfo[],
): Record<string, ColumnOverride> {
  const overrides: Record<string, ColumnOverride> = {};
  for (const col of columns) {
    overrides[col.name] = {
      excluded: col.suggested_excluded,
      type: col.suggested_type,
    };
  }
  return overrides;
}

export function extractOverrideArrays(
  overrides: Record<string, ColumnOverride>,
): {
  categorical: string[];
  excluded: string[];
} {
  const categorical = Object.entries(overrides)
    .filter(([, v]) => !v.excluded && v.type === "categorical")
    .map(([k]) => k);
  const excluded = Object.entries(overrides)
    .filter(([, v]) => v.excluded)
    .map(([k]) => k);
  return { categorical, excluded };
}

export function buildMergedConfig({
  defaults,
  task,
  strategy,
  folds,
  dataPath,
  target,
  overrides,
  evaluationMetrics,
}: {
  defaults: Record<string, unknown>;
  task: string;
  strategy: string;
  folds: number;
  dataPath: string;
  target: string;
  overrides: Record<string, ColumnOverride>;
  /**
   * UiSchema-derived eval metrics for the chosen task (#529). Seeded into
   * `evaluation.metrics` so the target-select PUT lands with a complete
   * Evaluation slice. Without this, `GET /config/defaults` returns
   * `evaluation.metrics: []`, which lets `MetricsChips`'s task-change
   * useEffect race the target-select PUT and emit a partial-body PUT
   * (`{evaluation:{metrics:[...]}}`) that the backend rejects with
   * `saved=false, blocking=5`. Pass `[]` to preserve legacy behaviour.
   */
  evaluationMetrics?: readonly string[];
}): Record<string, unknown> {
  const { categorical, excluded } = extractOverrideArrays(overrides);
  const defaultsEval = (defaults.evaluation as Record<string, unknown>) ?? {};
  return {
    ...defaults,
    task,
    data: {
      ...(defaults.data as object),
      path: dataPath || undefined,
      target,
    },
    features: {
      ...(defaults.features as object),
      categorical,
      exclude: excluded,
    },
    split: {
      method: strategy,
      n_splits: folds,
    },
    evaluation: {
      ...defaultsEval,
      metrics:
        evaluationMetrics !== undefined && evaluationMetrics.length > 0
          ? [...evaluationMetrics]
          : ((defaultsEval.metrics as unknown[] | undefined) ?? []),
    },
  };
}

export function buildSyncKey(
  target: string | null,
  task: TaskType | null,
  overrides: Record<string, ColumnOverride>,
  cv: unknown,
  blocked: unknown,
): string {
  return JSON.stringify({ target, task, overrides, cv, blocked });
}
