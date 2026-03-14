import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "./NumberInput";

interface SegmentedControlProps {
  presets: Array<{ label: string; value: number | null }>;
  value: number | null;
  onChange: (v: number | null) => void;
  allowCustom?: boolean;
  customLabel?: string;
}

export function SegmentedControl({
  presets,
  value,
  onChange,
  allowCustom = false,
  customLabel = "Custom",
}: SegmentedControlProps) {
  const isPreset = presets.some((p) => p.value === value);
  // Derive custom mode from prop — no stale internal state
  const [forceCustom, setForceCustom] = useState(false);
  const customActive =
    allowCustom && (forceCustom || (!isPreset && value !== null));

  const handlePresetClick = (presetValue: number | null) => {
    setForceCustom(false);
    onChange(presetValue);
  };

  const handleCustomClick = () => {
    setForceCustom(true);
    if (isPreset || value === null) {
      const firstNumeric = presets.find((p) => p.value !== null);
      onChange(firstNumeric?.value ?? 50);
    }
  };

  const handleCustomChange = (v: number | undefined) => {
    onChange(v ?? null);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            variant={
              !customActive && value === preset.value ? "default" : "outline"
            }
            size="sm"
            className="h-7 text-xs px-3"
            type="button"
            onClick={() => handlePresetClick(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
        {allowCustom && (
          <Button
            variant={customActive ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-3"
            type="button"
            onClick={handleCustomClick}
          >
            {customLabel}
          </Button>
        )}
      </div>
      {customActive && (
        <div className="mt-1.5">
          <NumberInput
            value={value ?? undefined}
            onChange={handleCustomChange}
            min={0}
            placeholder="Value"
          />
        </div>
      )}
    </div>
  );
}
