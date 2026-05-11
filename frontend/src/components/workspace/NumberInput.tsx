import { Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface NumberInputProps {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /**
   * Accessible name for the input element. Wrapping <Label> components
   * in this codebase frequently omit `htmlFor`, so we expose `aria-label`
   * here to give each input a stable name without requiring every call
   * site to thread an `id`. E2E specs rely on this to drive the field
   * via `getByRole("textbox", { name: ... })`.
   */
  ariaLabel?: string;
  /**
   * P-0104 Wave 2.4 / Issue #460: when "integer", the input rejects
   * decimal characters during typing, rounds parsed values on blur via
   * `Math.round`, advertises `inputMode="numeric"` to mobile keyboards,
   * and surfaces an inline warning when a decimal value is detected
   * (e.g. via paste). Defaults to "number" to preserve historical
   * behaviour for unspecified call sites.
   */
  paramType?: "number" | "integer";
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  placeholder,
  disabled,
  className,
  id,
  ariaLabel,
  paramType = "number",
}: NumberInputProps) {
  const isInteger = paramType === "integer";

  // Track raw text to allow intermediate input like "0." or "1.0"
  const [raw, setRaw] = useState(value == null ? "" : String(value));
  // Surface a decimal attempt without dropping the typed text so the
  // user can see and correct it themselves.
  const [hasIntegerViolation, setHasIntegerViolation] = useState(false);

  // Sync raw text when external value changes (e.g. stepper buttons)
  useEffect(() => {
    const externalStr = value == null ? "" : String(value);
    setRaw((prev) => {
      // Don't overwrite if the user is mid-edit and the parsed value matches
      const parsed = Number(prev);
      if (prev !== "" && !Number.isNaN(parsed) && parsed === value) return prev;
      return externalStr;
    });
  }, [value]);

  const clamp = useCallback(
    (v: number) => {
      let clamped = v;
      if (min !== undefined) clamped = Math.max(clamped, min);
      if (max !== undefined) clamped = Math.min(clamped, max);
      return clamped;
    },
    [min, max],
  );

  const handleIncrement = () => {
    const next = clamp((value ?? 0) + step);
    onChange(next);
  };

  const handleDecrement = () => {
    const next = clamp((value ?? 0) - step);
    onChange(next);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setRaw(text);
    if (text === "" || text === "-") {
      onChange(undefined);
      setHasIntegerViolation(false);
      return;
    }
    if (isInteger) {
      // Decimal characters are not legal here; keep the raw text so the
      // user can correct it and flag the violation. onChange only fires
      // for valid integer strings.
      if (text.includes(".")) {
        setHasIntegerViolation(true);
        return;
      }
      setHasIntegerViolation(false);
      if (/^-?\d+$/.test(text)) {
        const parsed = Number(text);
        if (!Number.isNaN(parsed)) {
          onChange(clamp(parsed));
        }
      }
      return;
    }
    // number mode: allow intermediate states "0.", "1.", ".5", "-0."
    if (/^-?\d*\.?\d*$/.test(text)) {
      const parsed = Number(text);
      if (!Number.isNaN(parsed)) {
        onChange(clamp(parsed));
      }
    }
  };

  const handleBlur = () => {
    // Finalize on blur: parse and clamp, or clear
    if (raw === "" || raw === "-" || raw === ".") {
      setRaw("");
      onChange(undefined);
      setHasIntegerViolation(false);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      const coerced = isInteger ? Math.round(parsed) : parsed;
      const clamped = clamp(coerced);
      onChange(clamped);
      setRaw(String(clamped));
      setHasIntegerViolation(false);
    } else {
      setRaw(value == null ? "" : String(value));
      setHasIntegerViolation(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={handleDecrement}
          disabled={disabled}
          type="button"
          aria-label="Decrement"
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Input
          id={id}
          type="text"
          inputMode={isInteger ? "numeric" : "decimal"}
          value={raw}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={hasIntegerViolation || undefined}
          className={cn(
            "h-7 w-20 text-center text-xs tabular-nums [appearance:textfield]",
            hasIntegerViolation &&
              "border-destructive focus-visible:ring-destructive",
          )}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={handleIncrement}
          disabled={disabled}
          type="button"
          aria-label="Increment"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {hasIntegerViolation && (
        <p className="text-[10px] leading-tight text-destructive" role="alert">
          Integer values only
        </p>
      )}
    </div>
  );
}
