import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** P-0117 D4: the banner shows at most this many messages in total. */
export const MAX_JOB_WARNINGS = 50;
/** Messages shown while the list is collapsed. */
const COLLAPSED_COUNT = 2;

/**
 * Merge the warnings fetched from ``GET /api/jobs/{id}`` with those received
 * over the WebSocket (P-0117 D4).
 *
 * Fetched messages come first, in server order; live messages follow only if
 * absent (exact string match). The result is capped at ``MAX_JOB_WARNINGS``
 * and no message is truncated. The WebSocket ``warning`` message is not
 * replayed, so a reload or a completed job is served by the fetched list.
 */
export function mergeJobWarnings(
  fetched: readonly string[],
  live: readonly string[],
): string[] {
  const seen = new Set<string>(fetched);
  const merged = [...fetched];
  for (const message of live) {
    if (seen.has(message)) continue;
    seen.add(message);
    merged.push(message);
  }
  return merged.slice(0, MAX_JOB_WARNINGS);
}

export interface JobWarningsProps {
  /** Already merged and distinct (see ``mergeJobWarnings``). */
  warnings: readonly string[];
  status: string;
}

function isActive(status: string): boolean {
  return status === "running" || status === "paused";
}

function helperText(status: string): string {
  const review =
    "If memory use is a concern, review max_depth and num_leaves in the config.";
  if (status === "failed" || status === "cancelled") return review;
  return `The job was not stopped. ${review}`;
}

/**
 * Announces a newly arrived warning to assistive technology while a job is
 * running. Initial render, the fetch of an existing job and the change to
 * completed stay silent: only a count increase after mount, while running.
 */
function useWarningAnnouncement(count: number, status: string): string {
  const [announcement, setAnnouncement] = useState("");
  const previousCount = useRef(count);
  useEffect(() => {
    const increase = count - previousCount.current;
    previousCount.current = count;
    if (increase > 0 && status === "running") {
      setAnnouncement(
        increase === 1 ? "New job warning." : "New job warnings.",
      );
    }
  }, [count, status]);
  return announcement;
}

export function JobWarnings({ warnings, status }: JobWarningsProps) {
  const headingId = useId();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const announcement = useWarningAnnouncement(warnings.length, status);

  const announcer = isActive(status) ? (
    <div
      role="status"
      aria-live="polite"
      className="sr-only"
      data-testid="job-warnings-announcer"
    >
      {announcement}
    </div>
  ) : null;

  if (warnings.length === 0) return announcer;

  const collapsible = warnings.length > COLLAPSED_COUNT;
  const visible =
    collapsible && !expanded ? warnings.slice(0, COLLAPSED_COUNT) : warnings;
  const hiddenCount = warnings.length - COLLAPSED_COUNT;

  return (
    <>
      {announcer}
      <section
        aria-labelledby={headingId}
        className="mb-4 min-w-0 rounded-md border border-warning-border bg-warning p-3"
        data-testid="job-warnings"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-fg"
            aria-hidden="true"
          />
          <div className="flex-1">
            <h4 id={headingId} className="text-sm font-medium text-warning-fg">
              {warnings.length === 1
                ? "Warning"
                : `Warnings (${warnings.length})`}
            </h4>
            <p className="text-xs text-warning-fg/80">{helperText(status)}</p>
          </div>
        </div>
        <ul
          id={listId}
          className="mt-2 max-h-64 space-y-2 overflow-y-auto"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the list scrolls (max-h-64) and must be reachable by keyboard (spec §4)
          tabIndex={0}
          aria-label="Warning messages"
        >
          {visible.map((message) => (
            <li
              key={message}
              className="text-sm text-warning-fg [overflow-wrap:anywhere]"
              data-testid="job-warning-item"
            >
              {message}
            </li>
          ))}
        </ul>
        {collapsible && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-auto p-1 text-warning-fg hover:bg-warning/60"
            aria-expanded={expanded}
            aria-controls={listId}
            data-testid="job-warnings-toggle"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? "Show less" : `Show ${hiddenCount} more`}
          </Button>
        )}
      </section>
    </>
  );
}
