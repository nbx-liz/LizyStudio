import { Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
}: NumberInputProps) {
  // Track raw text to allow intermediate input like "0." or "1.0"
  const [raw, setRaw] = useState(value == null ? "" : String(value));

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
      return;
    }
    // Allow intermediate states: "0.", "1.", ".5", "-0."
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
      return;
    }
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      const clamped = clamp(parsed);
      onChange(clamped);
      setRaw(String(clamped));
    } else {
      setRaw(value == null ? "" : String(value));
    }
  };

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
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
        inputMode="decimal"
        value={raw}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className="h-7 w-20 text-center text-xs tabular-nums [appearance:textfield]"
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
  );
}
