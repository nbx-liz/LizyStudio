interface CompactStepperProps {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Explicit input id. Pre-existing API used by callers that wire
   * their own <label htmlFor>.
   */
  inputId?: string;
  /**
   * Generic `id` prop. Issue #90: FormRow / FormField propagate an
   * auto-generated id via cloneElement so axe's `label` rule passes
   * for steppers nested inside those wrappers without each call site
   * having to thread `inputId` manually.
   */
  id?: string;
}

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (min !== undefined && result < min) result = min;
  if (max !== undefined && result > max) result = max;
  return result;
}

export function CompactStepper({
  value,
  onChange,
  step = 1,
  min,
  max,
  placeholder,
  disabled = false,
  inputId,
  id,
}: CompactStepperProps) {
  // Prefer the explicit `inputId` (legacy API) when both are passed.
  const resolvedInputId = inputId ?? id;
  const handleDecrement = () => {
    const current = value ?? 0;
    onChange(clamp(current - step, min, max));
  };

  const handleIncrement = () => {
    const current = value ?? 0;
    onChange(clamp(current + step, min, max));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      onChange(undefined);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      onChange(parsed);
    }
  };

  const handleBlur = () => {
    if (value === undefined) return;
    const clamped = clamp(value, min, max);
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  return (
    <div className="lzs-stepper">
      <button
        type="button"
        className="lzs-stepper__btn"
        onClick={handleDecrement}
        disabled={disabled}
      >
        {"−"}
      </button>
      <input
        id={resolvedInputId}
        type="text"
        inputMode="decimal"
        className="lzs-stepper__input"
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      <button
        type="button"
        className="lzs-stepper__btn"
        onClick={handleIncrement}
        disabled={disabled}
      >
        +
      </button>
    </div>
  );
}
