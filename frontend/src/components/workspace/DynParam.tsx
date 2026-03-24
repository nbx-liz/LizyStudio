import type { ParameterHint } from "@/api/types";
import { ChipGroup } from "./ChipGroup";
import { CompactStepper } from "./CompactStepper";
import { CompactToggle } from "./CompactToggle";
import { FormRow } from "./FormRow";
import { SegmentGroup } from "./SegmentGroup";

interface DynParamProps {
  hint: ParameterHint;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Options list for objective / model_metric kinds (task-filtered). */
  options?: string[];
  /** Whether the field is visible (conditional_visibility). */
  visible?: boolean;
}

/**
 * Renders a single parameter based on its ParameterHint.kind.
 *
 * Maps:
 *   objective    -> SegmentGroup  (single-select)
 *   model_metric -> ChipGroup     (multi-select among task metrics)
 *   integer      -> CompactStepper
 *   number       -> CompactStepper
 *   boolean      -> CompactToggle
 */
export function DynParam({
  hint,
  value,
  onChange,
  options,
  visible = true,
}: DynParamProps) {
  if (!visible) return null;

  switch (hint.kind) {
    case "objective": {
      const opts = options ?? [];
      if (opts.length === 0) return null;
      return (
        <FormRow label={hint.label}>
          <SegmentGroup
            options={opts}
            value={typeof value === "string" ? value : ""}
            onChange={(v) => onChange(v)}
          />
        </FormRow>
      );
    }

    case "model_metric": {
      const opts = options ?? [];
      if (opts.length === 0) return null;
      const selected = Array.isArray(value)
        ? (value as string[])
        : typeof value === "string"
          ? [value]
          : [];
      return (
        <FormRow label={hint.label}>
          <ChipGroup
            options={opts}
            selected={selected}
            onChange={(v) => onChange(v)}
            minSelected={1}
          />
        </FormRow>
      );
    }

    case "integer":
    case "number": {
      const numValue =
        value !== undefined && value !== null ? Number(value) : undefined;
      const step = hint.step ?? (hint.kind === "integer" ? 1 : 0.01);
      const placeholder =
        hint.default !== undefined && hint.default !== null
          ? String(hint.default)
          : undefined;
      return (
        <FormRow label={hint.label}>
          <CompactStepper
            value={numValue}
            onChange={(v) => onChange(v)}
            step={step}
            placeholder={placeholder}
          />
        </FormRow>
      );
    }

    case "boolean": {
      const boolValue = value === true;
      return (
        <FormRow label={hint.label}>
          <CompactToggle checked={boolValue} onChange={(v) => onChange(v)} />
        </FormRow>
      );
    }

    default:
      return null;
  }
}
