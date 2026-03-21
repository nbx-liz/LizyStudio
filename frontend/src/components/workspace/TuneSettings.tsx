import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import { N_TRIALS_PRESETS, TIMEOUT_PRESETS } from "./constants";
import { SegmentedControl } from "./SegmentedControl";

interface TuneSettingsProps {
  tuningParams: {
    n_trials?: number;
    timeout?: number | null;
  };
  onChange: (params: Record<string, unknown>) => void;
  nTrialsPresets?: number[];
}

export function TuneSettings({
  tuningParams,
  onChange,
  nTrialsPresets,
}: TuneSettingsProps) {
  const nTrials = tuningParams.n_trials ?? 50;
  const timeout = tuningParams.timeout ?? null;

  const effectivePresets = nTrialsPresets ?? N_TRIALS_PRESETS;
  const nTrialsPresetsItems = effectivePresets.map((v) => ({
    label: String(v),
    value: v as number | null,
  }));

  const timeoutPresets: Array<{ label: string; value: number | null }> =
    TIMEOUT_PRESETS.map((p) => ({ label: p.label, value: p.value }));

  const handleNTrialsChange = (v: number | null) => {
    onChange({ ...tuningParams, n_trials: v ?? 50 });
  };

  const handleTimeoutChange = (v: number | null) => {
    onChange({ ...tuningParams, timeout: v });
  };

  return (
    <AccordionItem value="settings">
      <AccordionTrigger>Settings</AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 px-1">
          {/* n_trials */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1">
              Number of trials
            </Label>
            <SegmentedControl
              presets={nTrialsPresetsItems}
              value={nTrials}
              onChange={handleNTrialsChange}
              allowCustom
              customLabel="Custom"
            />
          </div>

          {/* timeout */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1">
              Timeout
            </Label>
            <SegmentedControl
              presets={timeoutPresets}
              value={timeout}
              onChange={handleTimeoutChange}
              allowCustom
              customLabel="Custom"
            />
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
