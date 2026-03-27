interface ChipGroupProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  minSelected?: number;
  labels?: Record<string, string>;
}

export function ChipGroup({
  options,
  selected,
  onChange,
  minSelected = 0,
  labels,
}: ChipGroupProps) {
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
        return (
          <button
            key={option}
            type="button"
            className={`lzs-chip${isActive ? " lzs-chip--active" : ""}`}
            aria-pressed={isActive}
            onClick={() => handleClick(option)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
