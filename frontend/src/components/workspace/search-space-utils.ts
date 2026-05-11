export const GROUP_LABELS: Record<string, string> = {
  model_params: "Model Params",
  smart_params: "Smart Params",
  training: "Training Params",
  additional: "Additional Params",
};

export interface SpaceEntry {
  type: "float" | "int" | "categorical";
  low?: number;
  high?: number;
  log?: boolean;
  step?: number;
  choices?: string[];
  category?: string;
}

/** Map UI group name to LizyML search space category. */
export function groupToCategory(group: string): string {
  if (group === "smart_params") return "smart";
  if (group === "training") return "training";
  return "model";
}

export function toSpaceEntry(raw: unknown): SpaceEntry | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const category = typeof obj.category === "string" ? obj.category : undefined;
  if (obj.type === "categorical") {
    return {
      type: "categorical",
      choices: Array.isArray(obj.choices) ? (obj.choices as string[]) : [],
      category,
    };
  }
  if (typeof obj.low !== "number" || typeof obj.high !== "number")
    return undefined;
  return {
    type: (obj.type as "float" | "int") ?? "float",
    low: obj.low,
    high: obj.high,
    log: (obj.log as boolean) ?? false,
    step: typeof obj.step === "number" ? obj.step : undefined,
    category,
  };
}

/** Resolve a catalog default that may be task-keyed (e.g. {binary: "binary"}). */
export function resolveCatalogDefault(
  raw: unknown,
  task: string | null | undefined,
): unknown {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (task && task in obj) return obj[task];
    // Task-keyed object but task unknown — don't guess
    return undefined;
  }
  return raw;
}

export function formatSummary(entry: SpaceEntry): string {
  const dist = entry.log ? " (log)" : "";
  return `${entry.low} ~ ${entry.high}${dist}`;
}

/**
 * Find Search Space entries in Choice (categorical) mode with no choices
 * (Issue #266). The backend rejects these with 422; surface them as a
 * client-side validation error so the Tune button can be disabled before
 * submission.
 */
export function findEmptyChoiceKeys(space: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const [key, raw] of Object.entries(space)) {
    if (raw == null || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    if (obj.type !== "categorical") continue;
    const choices = obj.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      keys.push(key);
    }
  }
  return keys;
}

/** Props for the SearchSpaceRow component. */
export interface SearchSpaceRowProps {
  param: {
    key: string;
    type: "float" | "integer" | "boolean";
    catalogDefault: unknown;
    description: string;
    modes: string[];
    paramType: string;
    group: string;
    defaultRange: { low: number; high: number; log: boolean } | undefined;
  };
  space: Record<string, unknown>;
  modelParams: Record<string, unknown>;
  isExpanded: boolean;
  onToggleExpand: (key: string) => void;
  onModeChange: (key: string, mode: string) => void;
  onUpdateEntry: (key: string, patch: Partial<SpaceEntry>) => void;
  onDistributionChange: (key: string, value: string) => void;
  getChoiceOptions: (key: string) => string[] | undefined;
  stepMap?: Record<string, number>;
  task?: string | null;
  objectiveOptions?: string[];
  metricOptions?: string[];
  /** Outer CV strategy from ``config.split.method`` — drives the
   * ``inner_valid_picker`` row's filtered options. */
  cvStrategy?: string;
  /** Full list of inner_valid options from ``uiSchema.inner_valid_options``;
   * filtered per ``cvStrategy`` at render time. */
  innerValidOptions?: string[];
  onModelParamChange?: (key: string, value: unknown) => void;
  specialSearchSpaceFields?: Record<string, string>;
  columns?: string[];
}
