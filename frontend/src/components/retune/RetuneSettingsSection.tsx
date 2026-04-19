import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  extractTuningField,
  updateTuningField,
} from "@/components/workspace/tune-config-utils";
import { cn } from "@/lib/utils";
import type { RetuneConfig } from "./types";

export interface RetuneSettingsSectionProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

const DEFAULTS: RetuneConfig = {
  n_rounds: 1,
  expand_boundary: true,
  boundary_threshold: 0.05,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function RetuneSettingsSection({
  config,
  onChange,
}: RetuneSettingsSectionProps) {
  const raw = extractTuningField<Partial<RetuneConfig>>(
    config,
    "re_tune",
    DEFAULTS,
  );

  const cfg: RetuneConfig = {
    n_rounds: raw.n_rounds ?? DEFAULTS.n_rounds,
    expand_boundary: raw.expand_boundary ?? DEFAULTS.expand_boundary,
    boundary_threshold: raw.boundary_threshold ?? DEFAULTS.boundary_threshold,
  };

  const update = (patch: Partial<RetuneConfig>) => {
    onChange(updateTuningField(config, "re_tune", { ...cfg, ...patch }));
  };

  const handleNRoundsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(e.target.value);
    const value = Number.isNaN(parsed)
      ? DEFAULTS.n_rounds
      : clamp(parsed, 1, 10);
    update({ n_rounds: value });
  };

  const handleBoundaryThresholdChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const parsed = Number(e.target.value);
    const value = Number.isNaN(parsed)
      ? DEFAULTS.boundary_threshold
      : clamp(parsed, 0, 0.49);
    update({ boundary_threshold: value });
  };

  const handleExpandBoundaryChange = (checked: boolean | "indeterminate") => {
    // Radix Checkbox's type signature allows "indeterminate" but a
    // controlled boolean checkbox never emits it — ignore defensively.
    if (checked === "indeterminate") return;
    update({ expand_boundary: checked });
  };

  const multiRoundDisabled = cfg.n_rounds === 1;

  return (
    <AccordionItem value="retune" className="border-b">
      <AccordionTrigger className="py-1.5 text-sm font-medium hover:bg-muted/50">
        Re-tune (multi-round)
      </AccordionTrigger>
      <AccordionContent>
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
              Total tuning rounds. 1 = classic single-round tune.
            </p>
          </div>

          {/* Expand boundary */}
          <div className={cn("space-y-1", multiRoundDisabled && "opacity-50")}>
            <div className="flex items-center gap-2">
              <Checkbox
                id="retune-expand-boundary"
                checked={cfg.expand_boundary}
                onCheckedChange={handleExpandBoundaryChange}
                disabled={multiRoundDisabled}
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
          <div className={cn("space-y-1", multiRoundDisabled && "opacity-50")}>
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
              disabled={multiRoundDisabled}
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
      </AccordionContent>
    </AccordionItem>
  );
}
