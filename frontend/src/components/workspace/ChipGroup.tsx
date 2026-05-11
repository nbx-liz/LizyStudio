interface ChipGroupProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  minSelected?: number;
  labels?: Record<string, string>;
  /** Options that should render a small "Custom (slow)" badge — used for
   * LizyML custom feval metrics (P-0104 Wave 3.1b / Q2). */
  customOptions?: string[];
}

export function ChipGroup({
  options,
  selected,
  onChange,
  minSelected = 0,
  labels,
  customOptions,
}: ChipGroupProps) {
  const customSet = new Set(customOptions ?? []);
  const handleClick = (option: string) => {
    const isSelected = selected.includes(option);
    if (isSelected) {
      if (selected.length <= minSelected) return;
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: custom styled chip group, fieldset would break layout
    <div className="lzs-chip-group" role="group">
      {options.map((option) => {
        const isActive = selected.includes(option);
        const label = labels?.[option] ?? option;
        const isCustom = customSet.has(option);
        return (
          <button
            key={option}
            type="button"
            className={`lzs-chip${isActive ? " lzs-chip--active" : ""}`}
            aria-pressed={isActive}
            title={
              isCustom
                ? "Custom feval metric — re-evaluated in Python each round (slower)"
                : undefined
            }
            onClick={() => handleClick(option)}
          >
            {label}
            {isCustom && (
              <span className="ml-1 rounded-sm bg-amber-500/15 px-1 text-[8px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Custom (slow)
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
