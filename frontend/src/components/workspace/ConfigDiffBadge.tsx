import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ConfigDiffBadgeProps {
  jobConfig: Record<string, unknown>;
  currentConfig: Record<string, unknown> | undefined;
}

interface ConfigDiff {
  target: { job: string | null; current: string | null } | null;
  exclude: { job: string[]; current: string[] } | null;
  categorical: { job: string[]; current: string[] } | null;
}

function extractTarget(config: Record<string, unknown>): string | null {
  const data = config.data as Record<string, unknown> | undefined;
  const target = data?.target;
  return typeof target === "string" ? target : null;
}

function extractStringArray(
  config: Record<string, unknown>,
  field: string,
): string[] {
  const features = config.features as Record<string, unknown> | undefined;
  const raw = features?.[field];
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string").sort()
    : [];
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function computeDiff(
  jobConfig: Record<string, unknown>,
  currentConfig: Record<string, unknown>,
): ConfigDiff | null {
  const jobTarget = extractTarget(jobConfig);
  const curTarget = extractTarget(currentConfig);
  const jobExclude = extractStringArray(jobConfig, "exclude");
  const curExclude = extractStringArray(currentConfig, "exclude");
  const jobCat = extractStringArray(jobConfig, "categorical");
  const curCat = extractStringArray(currentConfig, "categorical");

  const targetDiff =
    jobTarget !== curTarget ? { job: jobTarget, current: curTarget } : null;
  const excludeDiff = !arraysEqual(jobExclude, curExclude)
    ? { job: jobExclude, current: curExclude }
    : null;
  const catDiff = !arraysEqual(jobCat, curCat)
    ? { job: jobCat, current: curCat }
    : null;

  if (!targetDiff && !excludeDiff && !catDiff) return null;
  return { target: targetDiff, exclude: excludeDiff, categorical: catDiff };
}

export function ConfigDiffBadge({
  jobConfig,
  currentConfig,
}: ConfigDiffBadgeProps) {
  if (!currentConfig) return null;

  const diff = computeDiff(jobConfig, currentConfig);
  if (!diff) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className="cursor-pointer border-warning-border text-warning-fg hover:bg-warning"
          role="button"
          tabIndex={0}
        >
          <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
          Settings changed
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-xs">
        <p className="mb-2 font-medium">
          Current settings differ from this job&apos;s snapshot:
        </p>
        {diff.target && (
          <DiffRow
            label="Target"
            job={diff.target.job ?? "(none)"}
            current={diff.target.current ?? "(none)"}
          />
        )}
        {diff.exclude && (
          <DiffRow
            label="Excluded"
            job={formatList(diff.exclude.job)}
            current={formatList(diff.exclude.current)}
          />
        )}
        {diff.categorical && (
          <DiffRow
            label="Categorical"
            job={formatList(diff.categorical.job)}
            current={formatList(diff.categorical.current)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function DiffRow({
  label,
  job,
  current,
}: {
  label: string;
  job: string;
  current: string;
}) {
  return (
    <div className="mb-1.5 last:mb-0">
      <span className="font-medium">{label}:</span>
      <div className="ml-2 text-muted-foreground">
        <div>
          Job: <span className="text-foreground">{job}</span>
        </div>
        <div>
          Now: <span className="text-foreground">{current}</span>
        </div>
      </div>
    </div>
  );
}

function formatList(items: string[]): string {
  return items.length === 0 ? "(none)" : items.join(", ");
}
