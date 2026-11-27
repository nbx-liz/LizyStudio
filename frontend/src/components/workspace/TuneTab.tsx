import { useCallback, useEffect, useMemo, useState } from "react";
import { useTuningSnapshot } from "@/api/queries/useWorkspace";
import type { MetricEntry } from "@/api/types";
import { RetuneSettingsSection } from "@/components/retune";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  materializeOp,
  type PatchEntry,
  type TuneWriteReason,
} from "@/hooks/useConfigWriteFunnel";
import { filterInnerValidOptions, recommendedInnerValid } from "./cv-state";
import {
  evalMetricOptionsFor,
  metricChoicesFor,
  metricOptionsFor,
  objectiveOptionsFor,
} from "./metric-options";
import { groupToCategory, SearchSpaceTable } from "./SearchSpaceTable";
import { TuneEvaluationSection } from "./TuneEvaluationSection";
import { TuneSettings } from "./TuneSettings";
import { extractOptunaField, extractTuningField } from "./tune-config-utils";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * One patch per `optuna.params` key whose value changed (a removed key is
 * patched to `undefined`, which the JSON body omits). Per key, not the
 * whole object: the rendered params can lag the server after a legacy
 * write, and a whole-object patch would then overwrite a sibling the
 * server still holds (e.g. `n_trials` when only `timeout` was edited).
 */
function paramPatches(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): PatchEntry[] {
  const patches: PatchEntry[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) {
      patches.push({ path: [...OPTUNA_PARAMS_PATH, key], value: after[key] });
    }
  }
  return patches;
}

/** Value at `path` in a config tree, or `undefined` when absent. */
function valueAt(
  config: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let node: unknown = config;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Model params that make up the Tune-side inner split. */
const INNER_SPLIT_KEYS: ReadonlySet<string> = new Set([
  "inner_valid",
  "validation_ratio",
]);

/**
 * P-0111: the Tune tab's routed write path. `tuning_overrides` patches
 * (the five tuning fields) go to `PUT /config/tuning-overrides`;
 * `legacy_config` patches (`model.params`, the inner split marker,
 * `tuning.re_tune`) go to the legacy `PUT /config`.
 */
export type TuneWriteHandler = (
  patches: readonly PatchEntry[],
  reason: TuneWriteReason,
) => unknown;

const OPTUNA_PARAMS_PATH = ["tuning", "optuna", "params"] as const;
const OPTUNA_SPACE_PATH = ["tuning", "optuna", "space"] as const;
const EVALUATION_PATH = ["tuning", "evaluation"] as const;
const RE_TUNE_PATH = ["tuning", "re_tune"] as const;

interface TuneTabProps {
  config: Record<string, unknown>;
  /**
   * Full-config writer. Used for every edit only when `onTuneWrite` is
   * absent (isolated renders); the patches are then applied to `config`.
   */
  onChange: (config: Record<string, unknown>) => void;
  onTuneWrite?: TuneWriteHandler;
  task: string | null;
  uiSchema?: import("@/api/types").UiSchema;
  columns?: string[];
}

export function TuneTab({
  config,
  onChange,
  onTuneWrite,
  task,
  uiSchema,
  columns,
}: TuneTabProps) {
  // P-0111: every Tune-tab edit is a set of patches on one write path.
  // Without a routed writer the patches are applied to the rendered
  // config and handed to `onChange` as before.
  // P-0111: a refused write must not stay on screen. Inputs that keep
  // their own text (NumberInput) would still show the refused value, so a
  // refusal remounts the tab's controls, which re-read the saved config.
  const [refusals, setRefusals] = useState(0);
  const write = useCallback(
    (patches: readonly PatchEntry[], reason: TuneWriteReason) => {
      if (patches.length === 0) return;
      if (onTuneWrite) {
        void Promise.resolve(onTuneWrite(patches, reason)).then((saved) => {
          if (saved === false) setRefusals((n) => n + 1);
        });
        return;
      }
      onChange(materializeOp({ kind: "patch-many", patches, reason }, config));
    },
    [config, onChange, onTuneWrite],
  );

  // Child sections that still emit a whole next config: route only the
  // tuning paths they changed, as `tuning_overrides` patches.
  const handleEvaluationChange = useCallback(
    (next: Record<string, unknown>) => {
      const patches: PatchEntry[] = [];
      const evaluation = valueAt(next, EVALUATION_PATH);
      if (evaluation !== valueAt(config, EVALUATION_PATH)) {
        patches.push({ path: EVALUATION_PATH, value: evaluation });
      }
      patches.push(
        ...paramPatches(
          asRecord(valueAt(config, OPTUNA_PARAMS_PATH)),
          asRecord(valueAt(next, OPTUNA_PARAMS_PATH)),
        ),
      );
      write(patches, "tuning_overrides");
    },
    [config, write],
  );

  const handleRetuneChange = useCallback(
    (next: Record<string, unknown>) => {
      write(
        [{ path: RE_TUNE_PATH, value: valueAt(next, RE_TUNE_PATH) }],
        "legacy_config",
      );
    },
    [write],
  );

  const tuningParams = extractOptunaField<{
    n_trials?: number;
    timeout?: number | null;
  }>(config, "params", {});

  const searchSpace = extractOptunaField<Record<string, unknown>>(
    config,
    "space",
    {},
  );

  // P-0109 PR-5: catalog-default search space, computed locally per render.
  //
  // Replaces the legacy "search-space init useEffect" that auto-wrote
  // catalog defaults to ``config.tuning.optuna.space`` on first mount.
  // That useEffect raced against TuneEvaluationSection's
  // direction-sync and metrics-seed useEffects through the WriteFunnel
  // — all three shared the ``config-form-edit`` reason and the funnel
  // coalesced them to the last-arriver, leaving the search-space write
  // dropped and every row rendering in Fixed mode.
  //
  // The fix: derive the rendering-only catalog defaults from
  // ``uiSchema.search_space_catalog`` at render time and merge with
  // the user's persisted overrides. No backend write fires unless the
  // user explicitly edits a row, so there is no race to lose.
  const catalogDefaultSpace = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const entry of uiSchema?.search_space_catalog ?? []) {
      if (entry.default_mode === "range" && entry.default_range) {
        out[entry.key] = {
          type: entry.paramType === "integer" ? "int" : "float",
          low: entry.default_range.low,
          high: entry.default_range.high,
          log: entry.default_range.log,
          category: groupToCategory(entry.group ?? "model_params"),
        };
      } else if (entry.default_mode === "choice" && entry.default_choices) {
        out[entry.key] = {
          type: "categorical",
          choices: entry.default_choices.map(String),
          category: groupToCategory(entry.group ?? "model_params"),
        };
      }
    }
    return out;
  }, [uiSchema]);

  const effectiveSpace = useMemo(
    () => ({ ...catalogDefaultSpace, ...searchSpace }),
    [catalogDefaultSpace, searchSpace],
  );

  // Evaluation from tuning.evaluation (Widget conformance — NOT tuning.optuna.evaluation)
  const evaluation = extractTuningField<{
    metrics?: MetricEntry[];
  }>(config, "evaluation", {});

  const modelSection = (config.model as Record<string, unknown>) ?? {};
  const modelParams = (modelSection.params as Record<string, unknown>) ?? {};

  // Eval-metrics registry list for the current task — used by the Tune
  // Evaluation section (Optimization Metric / Additional Metrics). These
  // are LizyML post-hoc reporting metrics, NOT the LightGBM ``metric`` param.
  const evalMetricOptions = useMemo(
    () => evalMetricOptionsFor(uiSchema, task),
    [task, uiSchema],
  );

  // metric_direction map for auto direction
  const metricDirection = useMemo(() => {
    return uiSchema?.metric_direction ?? undefined;
  }, [uiSchema]);

  // Objective options for task
  const objectiveOptions = useMemo(
    () => objectiveOptionsFor(uiSchema, task),
    [task, uiSchema],
  );

  // Model-metric options (``model.params.metric``) — flat native ∪ feval
  // list for the Search Space catalog ``metric`` row, plus the feval
  // subset for the "Custom (slow)" badge (P-0104 Wave 3.1b / Q2/Q3).
  const modelMetricOptions = useMemo(
    () => metricOptionsFor(uiSchema, task),
    [task, uiSchema],
  );
  const fevalMetrics = useMemo(
    () => metricChoicesFor(uiSchema, task).feval,
    [task, uiSchema],
  );

  // P-0104 Wave 3.1a / Issue #461: hyper-parameter bounds for the current
  // task, forwarded to SearchSpaceTable so Range Min/Max NumberInputs clamp.
  const parameterBounds = useMemo(() => {
    if (!task) return undefined;
    return uiSchema?.parameter_bounds?.[task] ?? undefined;
  }, [task, uiSchema]);

  // Per-parameter option sets keyed by Search Space catalog param name.
  // Only ``objective`` has a catalog row with choices; ``metric`` is
  // handled by SearchSpaceTable via the ``metricOptions`` prop, and
  // ``eval_metric`` is not a catalog param.
  const paramOptionSets = useMemo((): Record<string, string[]> => {
    const result: Record<string, string[]> = {};
    if (objectiveOptions.length > 0) result.objective = objectiveOptions;
    return result;
  }, [objectiveOptions]);

  // P-0109 PR-6c: subscribe to the Tune-tab intent/effective/defaults
  // triple. Used as:
  //   * ``tuning_defaults.evaluation_metrics`` — canonical eval-metric
  //     fallback for ``TuneEvaluationSection`` (replaces the frontend
  //     ``TASK_DEFAULT_METRICS`` constant that PR-5 left in place).
  //   * ``tuning_effective.user_set_paths`` — per-row "modified" badge
  //     provenance for ``SearchSpaceRow``. Entries the user explicitly
  //     touched render with the badge; catalog-default rows do not.
  // The query is enabled only when a task is set: a fresh workspace
  // (no task) returns empty defaults and an empty effective, and
  // running this before the user picks a task would pollute the cache
  // with a transient empty result.
  const { data: tuningSnapshot } = useTuningSnapshot({ enabled: !!task });
  const defaultEvaluationMetrics = useMemo<unknown[]>(() => {
    const fromSnapshot = tuningSnapshot?.tuning_defaults.evaluation_metrics;
    return Array.isArray(fromSnapshot) ? fromSnapshot : [];
  }, [tuningSnapshot]);
  const userSetSpaceKeys = useMemo<Set<string>>(() => {
    const paths = tuningSnapshot?.tuning_effective.user_set_paths ?? [];
    const out = new Set<string>();
    for (const p of paths) {
      if (p.startsWith("space.")) out.add(p.slice("space.".length));
    }
    return out;
  }, [tuningSnapshot]);

  const handleParamsChange = (params: Record<string, unknown>) => {
    write(paramPatches(tuningParams, params), "tuning_overrides");
  };

  const handleSpaceChange = (space: Record<string, unknown>) => {
    write([{ path: OPTUNA_SPACE_PATH, value: space }], "tuning_overrides");
  };

  // P-0116 child 5b: a Tune-side split pick (``inner_valid`` /
  // ``validation_ratio``) lives in ``model.params`` but the backend reads
  // the "user chose it" marker from ``training.early_stopping``. Both paths
  // are written in ONE write so the PUT budget stays at one write.
  // ``source`` is "user" for picks and "auto" for the CV-change recommend.
  // P-0111: ``model.params`` has no ``TuningOverrides`` field, so this is a
  // ``legacy_config`` write.
  const handleModelParamChange = useCallback(
    (key: string, value: unknown, source: "user" | "auto" = "user") => {
      const patches: PatchEntry[] = [{ path: ["model", "params", key], value }];
      if (INNER_SPLIT_KEYS.has(key)) {
        patches.push({
          path: ["training", "early_stopping", "inner_valid_explicit"],
          value: source === "user",
        });
      }
      write(patches, "legacy_config");
    },
    [write],
  );

  // P-0104 Wave 2.3 / Issue #459 — inner_valid auto-reset on CV strategy
  // change.
  //
  // When the outer CV strategy switches between time / group / standard
  // families, the persisted ``model.params.inner_valid`` may no longer be
  // a member of the strategy's allowed set (e.g. ``time_holdout`` is only
  // valid under ``time_series_*`` strategies). This effect reconciles the
  // persisted value to the strategy-recommended default so the UI and the
  // wire payload converge before the user runs a tune.
  const cvStrategy = useMemo(() => {
    const split = (config.split as Record<string, unknown>) ?? {};
    return typeof split.method === "string" ? split.method : "";
  }, [config.split]);

  // Drives the "Your choice / Automatic" cue; read straight from config.
  const innerValidExplicit = useMemo(() => {
    const training = (config.training as Record<string, unknown>) ?? {};
    const earlyStopping =
      (training.early_stopping as Record<string, unknown>) ?? {};
    return earlyStopping.inner_valid_explicit === true;
  }, [config.training]);

  const innerValidOptions = useMemo(
    () => uiSchema?.inner_valid_options ?? [],
    [uiSchema],
  );

  useEffect(() => {
    if (!cvStrategy || innerValidOptions.length === 0) return;
    const filtered = filterInnerValidOptions(innerValidOptions, cvStrategy);
    const current = modelParams.inner_valid;
    if (typeof current === "string" && filtered.includes(current)) return;
    const recommended = recommendedInnerValid(cvStrategy);
    if (current === recommended) return;
    handleModelParamChange("inner_valid", recommended, "auto");
  }, [cvStrategy, innerValidOptions, modelParams, handleModelParamChange]);

  return (
    <Accordion
      key={refusals}
      type="multiple"
      defaultValue={["settings", "search-space", "evaluation", "retune"]}
    >
      <TuneSettings
        tuningParams={tuningParams}
        onChange={handleParamsChange}
        nTrialsPresets={uiSchema?.n_trials_presets ?? undefined}
      />
      <AccordionItem value="search-space" className="border-b">
        <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
          Search Space
        </AccordionTrigger>
        <AccordionContent>
          <div className="pl-[18px]">
            <SearchSpaceTable
              space={effectiveSpace}
              modelParams={modelParams}
              onChange={handleSpaceChange}
              catalog={uiSchema?.search_space_catalog}
              stepMap={uiSchema?.step_map}
              task={task}
              objectiveOptions={objectiveOptions}
              metricOptions={modelMetricOptions}
              fevalMetrics={fevalMetrics}
              additionalParams={uiSchema?.additional_params ?? undefined}
              paramOptionSets={paramOptionSets}
              onModelParamChange={handleModelParamChange}
              conditionalVisibility={uiSchema?.conditional_visibility}
              specialSearchSpaceFields={
                uiSchema?.special_search_space_fields ?? undefined
              }
              columns={columns}
              cvStrategy={cvStrategy}
              innerValidOptions={innerValidOptions}
              innerValidExplicit={innerValidExplicit}
              parameterBounds={parameterBounds}
              userSetSpaceKeys={userSetSpaceKeys}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="evaluation" className="border-b">
        <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
          Evaluation
        </AccordionTrigger>
        <AccordionContent>
          <TuneEvaluationSection
            config={config}
            onChange={handleEvaluationChange}
            task={task}
            metricOptions={evalMetricOptions}
            metricDirection={metricDirection}
            evaluation={evaluation}
            tuningParams={tuningParams}
            defaultEvaluationMetrics={defaultEvaluationMetrics}
          />
        </AccordionContent>
      </AccordionItem>
      <RetuneSettingsSection config={config} onChange={handleRetuneChange} />
    </Accordion>
  );
}
