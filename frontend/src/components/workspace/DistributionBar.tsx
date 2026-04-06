import { useMemo } from "react";
import type { ValueCount } from "@/api/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Color palette for categorical segments. */
const SEGMENT_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-lime-500",
  "bg-fuchsia-500",
  "bg-sky-500",
  "bg-yellow-500",
  "bg-red-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-slate-500",
  "bg-zinc-500",
  "bg-stone-500",
] as const;

/** Color for the "other" bucket. */
const OTHER_COLOR = "bg-muted-foreground/40";

export interface DistributionBarProps {
  /** Value counts from the column-stats API. */
  valueCounts: ValueCount[];
  /** Total count (including nulls) — used to compute percentages. */
  totalCount: number;
  /** Bar height in pixels. Default: 8. */
  height?: number;
}

interface Segment {
  value: string;
  count: number;
  percent: number;
  color: string;
}

export function DistributionBar({
  valueCounts,
  totalCount,
  height = 8,
}: DistributionBarProps) {
  const segments: Segment[] = useMemo(() => {
    if (totalCount <= 0 || valueCounts.length === 0) return [];
    return valueCounts.map((vc, i) => ({
      value: vc.value,
      count: vc.count,
      percent: (vc.count / totalCount) * 100,
      color:
        vc.value === "__other__"
          ? OTHER_COLOR
          : SEGMENT_COLORS[i % SEGMENT_COLORS.length],
    }));
  }, [valueCounts, totalCount]);

  if (segments.length === 0) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div
        className="flex w-full overflow-hidden rounded-sm"
        style={{ height: `${height}px` }}
        role="img"
        aria-label="Value distribution"
        data-testid="distribution-bar"
      >
        {segments.map((seg) => (
          <Tooltip key={seg.value}>
            <TooltipTrigger asChild>
              <div
                className={`${seg.color} transition-all hover:opacity-80`}
                style={{
                  width: `${Math.max(seg.percent, 0.5)}%`,
                  minWidth: seg.percent > 0 ? "2px" : "0",
                }}
                data-testid={`segment-${seg.value}`}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <span className="font-medium">
                {seg.value === "__other__" ? "Other" : seg.value}
              </span>
              : {seg.count.toLocaleString()} ({seg.percent.toFixed(1)}%)
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
