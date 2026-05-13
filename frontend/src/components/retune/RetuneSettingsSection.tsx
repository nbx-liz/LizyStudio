import { useRef } from "react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  extractTuningField,
  updateTuningField,
} from "@/components/workspace/tune-config-utils";
import type { RetuneConfig } from "./types";

export interface RetuneSettingsSectionProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

// ON-state defaults instantiated when the user flips the Switch ON for the
// first time. `n_rounds=3` matches BLUEPRINT.md section 4.2.2 default and
// P-0104 Wave 2.1; the previous default of 1 was the buggy off-state proxy.
const ON_DEFAULTS: RetuneConfig = {
  n_rounds: 3,
  expand_boundary: true,
  boundary_threshold: 0.05,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Re-tune is considered active only when the payload exists AND n_rounds > 1.
// Legacy saves carrying `{n_rounds: 1, ...}` are auto-migrated to OFF on read
// per P-0104 Decision (D2 backward-compat / Q-2.1.1 = Option (b)).
function isReTuneActive(raw: unknown): raw is RetuneConfig {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Partial<RetuneConfig>;
  return typeof obj.n_rounds === "number" && obj.n_rounds > 1;
}

export function RetuneSettingsSection({
  config,
  onChange,
}: RetuneSettingsSectionProps) {
  const raw = extractTuningField<unknown>(config, "re_tune", null);
  const active = isReTuneActive(raw);

  // Preserves the last ON-state values so toggling OFF -> ON restores the
  // user's edits instead of resetting to defaults (Q-2.1.3 = Option (b)).
  const draftRef = useRef<RetuneConfig>(
    active ? (raw as RetuneConfig) : ON_DEFAULTS,
  );
  if (active) {
    draftRef.current = raw as RetuneConfig;
  }

  const cfg: RetuneConfig = active ? (raw as RetuneConfig) : draftRef.current;

  const writeActive = (next: RetuneConfig) => {
    draftRef.current = next;
    onChange(updateTuningField(config, "re_tune", next));
  };

  const handleSwitchChange = (checked: boolean) => {
    if (checked) {
      writeActive({ ...draftRef.current });
    } else {
      onChange(updateTuningField(config, "re_tune", null));
    }
  };

  const handleNRoundsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(e.target.value);
    const value = Number.isNaN(parsed)
      ? ON_DEFAULTS.n_rounds
      : clamp(parsed, 1, 10);
    writeActive({ ...cfg, n_rounds: value });
  };

  const handleBoundaryThresholdChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const parsed = Number(e.target.value);
    const value = Number.isNaN(parsed)
      ? ON_DEFAULTS.boundary_threshold
      : clamp(parsed, 0, 0.49);
    writeActive({ ...cfg, boundary_threshold: value });
  };

  const handleExpandBoundaryChange = (checked: boolean | "indeterminate") => {
    if (checked === "indeterminate") return;
    writeActive({ ...cfg, expand_boundary: checked });
  };

  return (
    <AccordionItem value="retune" className="border-b">
      <div className="flex items-center gap-2">
        <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50 flex-1">
          Re-tune (multi-round)
        </AccordionTrigger>
        <Switch
          aria-label="Enable Re-tune (multi-round)"
          checked={active}
          onCheckedChange={handleSwitchChange}
          onClick={(e) => e.stopPropagation()}
          className="mr-2"
        />
      </div>
      <AccordionContent>
        {active && (
          <div className="lzs-form space-y-2 pl-[18px] px-1">
            {/* Number of rounds */}
            <div className="space-y-1">
              <Label
                htmlFor="retune-n-rounds"
                className="text-sm text-muted-foreground"
              >
                Number of rounds
              </Label>
              <Input
                id="retune-n-rounds"
                type="number"
                min={1}
                max={10}
                step={1}
                value={cfg.n_rounds}
                onChange={handleNRoundsChange}
                aria-describedby="retune-n-rounds-hint"
              />
              <p
                id="retune-n-rounds-hint"
                className="text-xs text-muted-foreground"
              >
                Total tuning rounds (2-10 for multi-round; set Switch to OFF for
                a single-round tune).
              </p>
            </div>

            {/* Expand boundary */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="retune-expand-boundary"
                  checked={cfg.expand_boundary}
                  onCheckedChange={handleExpandBoundaryChange}
                />
                <Label
                  htmlFor="retune-expand-boundary"
                  className="text-sm text-muted-foreground"
                >
                  Expand boundary between rounds
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Grow the search space when the best value is near an edge.
              </p>
            </div>

            {/* Boundary threshold */}
            <div className="space-y-1">
              <Label
                htmlFor="retune-boundary-threshold"
                className="text-sm text-muted-foreground"
              >
                Boundary threshold
              </Label>
              <Input
                id="retune-boundary-threshold"
                type="number"
                min={0}
                max={0.49}
                step={0.01}
                value={cfg.boundary_threshold}
                onChange={handleBoundaryThresholdChange}
                aria-describedby="retune-threshold-hint"
              />
              <p
                id="retune-threshold-hint"
                className="text-xs text-muted-foreground"
              >
                Relative distance from edge that triggers expansion (0–0.49).
              </p>
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
