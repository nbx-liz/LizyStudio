import { useId } from "react";
import { Label } from "@/components/ui/label";
import { NumberInput } from "./NumberInput";

/** Small helper for nullable integer fields. */
export function NullableNumberField({
  label,
  value,
  onChange,
  placeholder,
  autoHint,
  hint,
  disabled,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  autoHint?: boolean;
  /** Transient helper text shown under the input and linked via aria-describedby. */
  hint?: string;
  disabled?: boolean;
}) {
  const hintId = useId();
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {autoHint && (
          <span className="text-muted-foreground text-[10px] ml-1">
            (empty = auto)
          </span>
        )}
      </Label>
      <NumberInput
        value={value}
        onChange={onChange}
        min={autoHint ? 1 : 0}
        step={1}
        placeholder={placeholder ?? "Auto"}
        disabled={disabled}
        ariaDescribedBy={hint ? hintId : undefined}
      />
      {hint && (
        <p id={hintId} className="text-[10px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
