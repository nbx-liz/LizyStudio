import { Minus, Plus } from "lucide-react";
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
}: NumberInputProps) {
  const clamp = (v: number) => {
    let clamped = v;
    if (min !== undefined) clamped = Math.max(clamped, min);
    if (max !== undefined) clamped = Math.min(clamped, max);
    return clamped;
  };

  const handleIncrement = () => {
    const next = clamp((value ?? 0) + step);
    onChange(next);
  };

  const handleDecrement = () => {
    const next = clamp((value ?? 0) - step);
    onChange(next);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      onChange(undefined);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      onChange(clamp(parsed));
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
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className="h-8 w-20 text-center text-xs tabular-nums [appearance:textfield]"
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
