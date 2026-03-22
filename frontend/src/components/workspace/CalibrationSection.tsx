import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CALIBRATION_DEFAULTS } from "./constants";
import { NumberInput } from "./NumberInput";

interface CalibrationSectionProps {
  calibration: Record<string, unknown> | null;
  onChange: (calibration: Record<string, unknown> | null) => void;
  calibrationDefaults?: Record<string, unknown>;
  calibrationMethods?: string[];
}

const FALLBACK_METHODS = ["platt", "isotonic", "beta"];

export function CalibrationSection({
  calibration,
  onChange,
  calibrationDefaults,
  calibrationMethods,
}: CalibrationSectionProps) {
  const defaults = calibrationDefaults ?? CALIBRATION_DEFAULTS;
  const methods = calibrationMethods ?? FALLBACK_METHODS;
  const isOn = calibration !== null;
  const method = (calibration?.method as string) ?? "platt";
  const nSplits = (calibration?.n_splits as number) ?? 5;

  const handleToggle = () => {
    if (isOn) {
      onChange(null);
    } else {
      onChange({ ...defaults });
    }
  };

  const handleMethodChange = (value: string) => {
    onChange({ ...calibration, method: value });
  };

  const handleNSplitsChange = (value: number | undefined) => {
    onChange({ ...calibration, n_splits: value ?? 5 });
  };

  return (
    <AccordionItem value="calibration">
      <AccordionTrigger className="py-1.5 text-sm font-medium">
        <div className="flex w-full items-center justify-between pr-2">
          <span>Calibration</span>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation needed for accordion */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper for event isolation */}
          <div onClick={(e) => e.stopPropagation()}>
            <Switch checked={isOn} onCheckedChange={handleToggle} />
          </div>
        </div>
      </AccordionTrigger>
      {isOn && (
        <AccordionContent>
          <div className="lzs-form space-y-1.5 pl-[18px] pt-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">method</Label>
              <Select value={method} onValueChange={handleMethodChange}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">
                  n_splits
                </Label>
                <p className="text-[10px] text-muted-foreground/70">
                  (deprecated — uses outer CV splits)
                </p>
              </div>
              <NumberInput
                value={nSplits}
                onChange={handleNSplitsChange}
                min={2}
                max={20}
                step={1}
              />
            </div>
          </div>
        </AccordionContent>
      )}
    </AccordionItem>
  );
}
