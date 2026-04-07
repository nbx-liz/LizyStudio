import { useState } from "react";
import { DynParam } from "./DynParam";

const ESSENTIAL_PARAM_KEYS = new Set([
  "objective",
  "metric",
  "n_estimators",
  "learning_rate",
  "max_depth",
  "num_leaves",
]);

export function ModelParamsSection({
  hints,
  getValueForHint,
  handleHintChange,
  getOptionsForHint,
  shouldShowField,
  precisionAtKValue,
  onPrecisionAtKChange,
}: {
  hints: import("@/api/types").ParameterHint[];
  getValueForHint: (hint: import("@/api/types").ParameterHint) => unknown;
  handleHintChange: (
    hint: import("@/api/types").ParameterHint,
    value: unknown,
  ) => void;
  getOptionsForHint: (hint: import("@/api/types").ParameterHint) => string[];
  shouldShowField: (key: string) => boolean;
  precisionAtKValue?: number;
  onPrecisionAtKChange?: (k: number) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const essential = hints.filter((h) => ESSENTIAL_PARAM_KEYS.has(h.key));
  const advanced = hints.filter((h) => !ESSENTIAL_PARAM_KEYS.has(h.key));

  return (
    <>
      {essential.map((hint) => (
        <DynParam
          key={hint.key}
          hint={hint}
          value={getValueForHint(hint)}
          onChange={(v) => handleHintChange(hint, v)}
          options={getOptionsForHint(hint)}
          visible={shouldShowField(hint.key)}
          precisionAtKValue={
            hint.kind === "model_metric" ? precisionAtKValue : undefined
          }
          onPrecisionAtKChange={
            hint.kind === "model_metric" ? onPrecisionAtKChange : undefined
          }
        />
      ))}
      {advanced.length > 0 && (
        <>
          <button
            type="button"
            className="mt-1 mb-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="toggle-advanced-params"
          >
            {showAdvanced
              ? `▾ Hide advanced (${advanced.length})`
              : `▸ Show advanced (${advanced.length})`}
          </button>
          {showAdvanced &&
            advanced.map((hint) => (
              <DynParam
                key={hint.key}
                hint={hint}
                value={getValueForHint(hint)}
                onChange={(v) => handleHintChange(hint, v)}
                options={getOptionsForHint(hint)}
                visible={shouldShowField(hint.key)}
                precisionAtKValue={
                  hint.kind === "model_metric" ? precisionAtKValue : undefined
                }
                onPrecisionAtKChange={
                  hint.kind === "model_metric"
                    ? onPrecisionAtKChange
                    : undefined
                }
              />
            ))}
        </>
      )}
    </>
  );
}
