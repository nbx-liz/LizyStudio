import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NumberInput } from "./NumberInput";
import { SegmentGroup } from "./SegmentGroup";

/** Threshold for switching between SegmentGroup and Select dropdown. */
const MAX_SEGMENT_OPTIONS = 4;

interface FixedValueEditorProps {
  paramType: string;
  value: unknown;
  onChange: (value: unknown) => void;
  options?: string[];
  step?: number;
  /** Accessible name for the rendered control (used as aria-label on
   * the Select trigger when options overflow to a dropdown). Falls back
   * to "Value" so screen readers still announce something meaningful. */
  ariaLabel?: string;
}

/**
 * Renders a paramType-appropriate editor for Fixed mode in SearchSpaceTable.
 *
 * - "number" | "integer"                   → NumberInput with stepper buttons
 * - "boolean"                              → Two-button segment (True / False)
 * - "string" + options (≤ MAX_SEGMENT_OPTIONS) → SegmentGroup buttons
 * - "string" + options (> MAX_SEGMENT_OPTIONS) → Select dropdown
 * - "string" / fallback                    → Plain text Input
 */
export function FixedValueEditor({
  paramType,
  value,
  onChange,
  options,
  step,
  ariaLabel,
}: FixedValueEditorProps) {
  if (paramType === "number" || paramType === "integer") {
    const numericValue = value == null ? undefined : Number(value);
    const effectiveStep = step ?? (paramType === "integer" ? 1 : 0.001);
    return (
      <NumberInput
        value={Number.isNaN(numericValue) ? undefined : numericValue}
        onChange={(v) => onChange(v)}
        step={effectiveStep}
      />
    );
  }

  if (paramType === "boolean") {
    // Normalise: accept boolean, "true"/"false" strings, or other truthy/falsy
    const isTrueActive = value === true || value === "true";
    return (
      <div className="flex gap-0.5">
        <Button
          type="button"
          size="sm"
          variant={isTrueActive ? "default" : "outline"}
          className="h-6 text-[10px] px-2"
          data-active={isTrueActive ? "true" : "false"}
          onClick={() => onChange(true)}
        >
          True
        </Button>
        <Button
          type="button"
          size="sm"
          variant={!isTrueActive ? "default" : "outline"}
          className="h-6 text-[10px] px-2"
          data-active={!isTrueActive ? "true" : "false"}
          onClick={() => onChange(false)}
        >
          False
        </Button>
      </div>
    );
  }

  if (paramType === "string" && options && options.length > 0) {
    const strValue = value == null ? "" : String(value);
    if (options.length <= MAX_SEGMENT_OPTIONS) {
      return (
        <SegmentGroup
          options={options}
          value={strValue}
          onChange={(v) => onChange(v)}
        />
      );
    }
    return (
      <Select value={strValue} onValueChange={(v) => onChange(v)}>
        <SelectTrigger
          aria-label={ariaLabel ?? "Value"}
          className="h-7 w-36 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Fallback: plain text input (covers "string" without options and unknown types)
  const strValue = value == null ? "" : String(value);
  return (
    <Input
      type="text"
      value={strValue}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-36 text-xs"
    />
  );
}
