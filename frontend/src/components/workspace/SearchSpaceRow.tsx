import { ChevronDown, ChevronRight } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChoiceInput } from "./ChoiceInput";
import { filterInnerValidOptions, recommendedInnerValid } from "./cv-state";
import { FeatureWeightsEditor } from "./FeatureWeightsEditor";
import { FixedValueEditor } from "./FixedValueEditor";
import { NumberInput } from "./NumberInput";
import { SegmentGroup } from "./SegmentGroup";
import type { SearchSpaceRowProps, SpaceEntry } from "./search-space-utils";
import {
  formatSummary,
  resolveCatalogDefault,
  toSpaceEntry,
} from "./search-space-utils";

export function SearchSpaceRow({
  param,
  space,
  modelParams,
  isExpanded,
  onToggleExpand,
  onModeChange,
  onUpdateEntry,
  onDistributionChange,
  getChoiceOptions,
  stepMap,
  task,
  objectiveOptions,
  metricOptions,
  fevalMetrics,
  cvStrategy,
  innerValidOptions,
  bounds,
  onModelParamChange,
  specialSearchSpaceFields,
  columns,
}: SearchSpaceRowProps) {
  const entry = toSpaceEntry(space[param.key]);
  const mode: "fixed" | "range" | "choice" = (() => {
    const e = space[param.key] as SpaceEntry | undefined;
    if (!e) return "fixed";
    if (e.type === "categorical") return "choice";
    return "range";
  })();
  const isRange = mode === "range";
  const isChoice = mode === "choice";
  const isExpandable = isRange || isChoice;
  const isInteger = param.type === "integer";
  const availableModes = param.modes ?? ["fixed", "range"];

  const handleSummaryActivate = () => {
    if (isExpandable) onToggleExpand(param.key);
  };

  return (
    <div key={param.key} className="border-b last:border-b-0">
      {/* Summary line — div+role=button avoids nesting interactive descendants
          (SegmentGroup buttons, NumberInput steppers) inside a real <button>
          which is invalid HTML and triggers React hydration warnings. */}
      {/* biome-ignore lint/a11y/useSemanticElements: native <button> would nest interactive descendants (#274) */}
      <div
        role="button"
        tabIndex={isExpandable ? 0 : -1}
        aria-expanded={isExpandable ? isExpanded : undefined}
        className="flex w-full items-center px-3 py-2 hover:bg-muted/30 cursor-pointer text-left"
        onClick={handleSummaryActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSummaryActivate();
          }
        }}
      >
        <span className="w-6 flex-shrink-0">
          {isExpandable &&
            (isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 mr-1.5 transition-transform" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 mr-1.5 transition-transform" />
            ))}
        </span>

        <span className="flex-1 text-xs font-mono">{param.key}</span>

        {/* Mode segment buttons */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation needed */}
        <div
          className="w-32"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <SegmentGroup
            options={availableModes}
            value={mode}
            onChange={(m) => onModeChange(param.key, m)}
            labels={Object.fromEntries(
              availableModes.map((m) => [
                m,
                m.charAt(0).toUpperCase() + m.slice(1),
              ]),
            )}
          />
        </div>

        {/* Summary / Fixed value editor */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation needed */}
        <span
          className="flex-1 flex justify-end text-xs text-muted-foreground tabular-nums"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {isRange && entry ? (
            formatSummary(entry)
          ) : isChoice && entry?.choices ? (
            entry.choices.join(", ")
          ) : onModelParamChange &&
            specialSearchSpaceFields?.[param.key] === "objective" ? (
            <SegmentGroup
              options={objectiveOptions ?? []}
              value={String(
                modelParams[param.key] ??
                  resolveCatalogDefault(param.catalogDefault, task) ??
                  "",
              )}
              onChange={(v) => onModelParamChange(param.key, v)}
            />
          ) : onModelParamChange &&
            specialSearchSpaceFields?.[param.key] === "metric" ? (
            <div className="flex flex-wrap gap-1">
              {(metricOptions ?? []).map((opt) => {
                const currentValue = modelParams[param.key];
                const selected = Array.isArray(currentValue)
                  ? currentValue.includes(opt)
                  : false;
                const isCustomFeval = (fevalMetrics ?? []).includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    title={
                      isCustomFeval
                        ? "Custom feval metric — re-evaluated in Python each round (slower)"
                        : undefined
                    }
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-transparent"
                        : "bg-transparent text-muted-foreground border-muted-foreground/30 hover:bg-muted"
                    }`}
                    onClick={() => {
                      const cur = Array.isArray(currentValue)
                        ? currentValue
                        : [];
                      const next = selected
                        ? cur.filter((m: string) => m !== opt)
                        : [...cur, opt];
                      onModelParamChange(param.key, next);
                    }}
                  >
                    {opt}
                    {isCustomFeval && (
                      <span className="rounded-sm bg-warning px-1 text-[8px] uppercase tracking-wide text-warning-fg">
                        Custom (slow)
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : onModelParamChange &&
            specialSearchSpaceFields?.[param.key] === "inner_valid_picker" ? (
            // P-0104 Wave 2.3 / Issue #459: inner_valid renders as a
            // SegmentGroup whose options depend on the outer CV strategy
            // (kfold -> [holdout]; group_* -> [holdout, group_holdout];
            // time_series_* -> [holdout, time_holdout]). The displayed
            // value falls back to ``recommendedInnerValid(strategy)`` when
            // the persisted value is not in the filtered list, so a CV
            // strategy switch from kfold -> time_series automatically
            // promotes "holdout" to "time_holdout" in the UI even before
            // the TuneTab auto-reset effect persists the change.
            (() => {
              const filtered = filterInnerValidOptions(
                innerValidOptions ?? [],
                cvStrategy ?? "",
              );
              const persisted = modelParams[param.key];
              const persistedStr =
                typeof persisted === "string" ? persisted : undefined;
              const display =
                persistedStr && filtered.includes(persistedStr)
                  ? persistedStr
                  : recommendedInnerValid(cvStrategy ?? "");
              return (
                <SegmentGroup
                  options={filtered}
                  value={display}
                  onChange={(v) => onModelParamChange(param.key, v)}
                />
              );
            })()
          ) : onModelParamChange && param.paramType === "object" ? (
            <FeatureWeightsEditor
              weights={
                (modelParams[param.key] as Record<string, number>) ?? null
              }
              columns={columns ?? []}
              onChange={(v) => onModelParamChange(param.key, v)}
            />
          ) : onModelParamChange ? (
            <FixedValueEditor
              paramType={param.paramType}
              value={
                modelParams[param.key] ??
                resolveCatalogDefault(param.catalogDefault, task)
              }
              onChange={(v) => onModelParamChange(param.key, v)}
              step={stepMap?.[param.key]}
              options={getChoiceOptions(param.key)}
              ariaLabel={param.key}
            />
          ) : (
            String(
              modelParams[param.key] ??
                resolveCatalogDefault(param.catalogDefault, task) ??
                "default",
            )
          )}
        </span>
      </div>

      {/* Range detail */}
      {isRange && isExpanded && entry && (
        <div className="px-6 py-2 bg-muted/20 space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground w-20">Min</Label>
            <NumberInput
              value={entry.low}
              onChange={(v) => onUpdateEntry(param.key, { low: v ?? 0 })}
              step={isInteger ? 1 : (stepMap?.[param.key] ?? 0.001)}
              paramType={isInteger ? "integer" : "number"}
              min={bounds?.min}
              max={bounds?.max}
              ariaLabel={`${param.key} min`}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground w-20">Max</Label>
            <NumberInput
              value={entry.high}
              onChange={(v) => onUpdateEntry(param.key, { high: v ?? 0 })}
              step={isInteger ? 1 : (stepMap?.[param.key] ?? 0.001)}
              paramType={isInteger ? "integer" : "number"}
              min={bounds?.min}
              max={bounds?.max}
              ariaLabel={`${param.key} max`}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground w-20">
              Distribution
            </Label>
            <Select
              value={entry.log ? "log-uniform" : "uniform"}
              onValueChange={(v) => onDistributionChange(param.key, v)}
            >
              <SelectTrigger
                aria-label={`${param.key} distribution`}
                className="h-7 w-36 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="uniform">Uniform</SelectItem>
                <SelectItem value="log-uniform">Log-uniform</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isInteger && (
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground w-20">Step</Label>
              <NumberInput
                value={entry.step}
                onChange={(v) => onUpdateEntry(param.key, { step: v })}
                min={1}
                step={1}
                paramType="integer"
                ariaLabel={`${param.key} step`}
              />
            </div>
          )}
        </div>
      )}

      {/* Choice mode — ChoiceInput handles known options and free-text */}
      {isChoice && isExpanded && entry && (
        <div className="px-6 py-2 bg-muted/20">
          <ChoiceInput
            choices={entry.choices ?? []}
            availableOptions={getChoiceOptions(param.key)}
            onChange={(choices) => onUpdateEntry(param.key, { choices })}
          />
        </div>
      )}

      {/* precision_at_k k-value row — Fixed and Choice modes */}
      {specialSearchSpaceFields?.[param.key] === "metric" &&
        onModelParamChange &&
        (() => {
          // Fixed: check modelParams; Choice: check space choices
          const fixedMetric = modelParams[param.key];
          const choiceMetric = entry?.choices;
          const hasPatK =
            (mode === "fixed" &&
              Array.isArray(fixedMetric) &&
              fixedMetric.includes("precision_at_k")) ||
            (mode === "choice" &&
              Array.isArray(choiceMetric) &&
              choiceMetric.includes("precision_at_k"));
          if (!hasPatK) return null;
          const kVal = (modelParams._precision_at_k_k as number) ?? 10;
          return (
            <div className="flex items-center gap-2 px-6 py-1.5 border-t bg-muted/10">
              <span className="text-xs font-mono text-muted-foreground">
                precision_at_k: k
              </span>
              <NumberInput
                value={kVal}
                onChange={(v) =>
                  onModelParamChange("_precision_at_k_k", v ?? 10)
                }
                min={1}
                max={100}
                step={1}
              />
            </div>
          );
        })()}
    </div>
  );
}
