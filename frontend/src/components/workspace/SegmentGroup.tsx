interface SegmentGroupProps {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  labels?: Record<string, string>;
  disabled?: boolean;
}

export function SegmentGroup({
  options,
  value,
  onChange,
  labels,
  disabled = false,
}: SegmentGroupProps) {
  return (
    <div className="lzs-segment" role="radiogroup">
      {options.map((opt) => {
        const isActive = opt === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: custom styled segment control requires button with radio role
          <button
            key={opt}
            type="button"
            className={`lzs-segment__btn${isActive ? " lzs-segment__btn--active" : ""}`}
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => {
              if (!isActive) onChange(opt);
            }}
          >
            {labels?.[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}
