import { Label } from "@/components/ui/label";
import { NumberInput } from "./NumberInput";

/** Small helper for nullable integer fields. */
export function NullableNumberField({
  label,
  value,
  onChange,
  placeholder,
  autoHint,
  disabled,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  autoHint?: boolean;
  disabled?: boolean;
}) {
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
      />
    </div>
  );
}
