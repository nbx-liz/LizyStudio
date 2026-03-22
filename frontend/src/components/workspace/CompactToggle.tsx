interface CompactToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function CompactToggle({
  checked,
  onChange,
  disabled = false,
}: CompactToggleProps) {
  return (
    <label className="lzs-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          if (disabled) return;
          onChange(e.target.checked);
        }}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
      />
      <span className="lzs-toggle__slider" />
    </label>
  );
}
