import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SearchSpaceTable } from "./SearchSpaceTable";
import { TuneSettings } from "./TuneSettings";

interface TuneTabProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  task: string | null;
  uiSchema?: import("@/api/types").UiSchema;
}

function updateTuningConfig(
  config: Record<string, unknown>,
  path: "params" | "space",
  value: unknown,
): Record<string, unknown> {
  const tuning = (config.tuning as Record<string, unknown>) ?? {};
  const optuna = (tuning.optuna as Record<string, unknown>) ?? {};
  return {
    ...config,
    tuning: { ...tuning, optuna: { ...optuna, [path]: value } },
  };
}

function extractOptunaField<T>(
  config: Record<string, unknown>,
  field: string,
  fallback: T,
): T {
  const tuning = config.tuning as Record<string, unknown> | undefined;
  const optuna = tuning?.optuna as Record<string, unknown> | undefined;
  return (optuna?.[field] as T) ?? fallback;
}

export function TuneTab({
  config,
  onChange,
  task: _task,
  uiSchema,
}: TuneTabProps) {
  const tuningParams = extractOptunaField<{
    n_trials?: number;
    direction?: string;
    timeout?: number | null;
  }>(config, "params", {});

  const searchSpace = extractOptunaField<Record<string, unknown>>(
    config,
    "space",
    {},
  );

  const modelSection = (config.model as Record<string, unknown>) ?? {};
  const modelParams = (modelSection.params as Record<string, unknown>) ?? {};

  const handleParamsChange = (params: Record<string, unknown>) => {
    onChange(updateTuningConfig(config, "params", params));
  };

  const handleSpaceChange = (space: Record<string, unknown>) => {
    onChange(updateTuningConfig(config, "space", space));
  };

  return (
    <Accordion type="multiple" defaultValue={["settings", "search-space"]}>
      <TuneSettings tuningParams={tuningParams} onChange={handleParamsChange} />
      <AccordionItem value="search-space">
        <AccordionTrigger>Search Space</AccordionTrigger>
        <AccordionContent>
          <SearchSpaceTable
            space={searchSpace}
            modelParams={modelParams}
            onChange={handleSpaceChange}
            catalog={uiSchema?.search_space_catalog}
            stepMap={uiSchema?.step_map}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
