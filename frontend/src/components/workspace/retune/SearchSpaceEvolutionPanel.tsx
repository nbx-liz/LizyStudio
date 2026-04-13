import type { BoundaryReport, TuneRound } from "./types";

export interface SearchSpaceEvolutionPanelProps {
  rounds: TuneRound[] | null | undefined;
  boundaryReport: BoundaryReport | null | undefined;
}

type NumericDim = {
  name: string;
  type: string;
  low: number;
  high: number;
  log?: boolean;
};

type CategoricalDim = {
  name: string;
  type: string;
  choices: unknown[];
};

type Dim = NumericDim | CategoricalDim;

function isNumericDim(
  raw: Record<string, unknown>,
): raw is NumericDim & Record<string, unknown> {
  return (
    typeof raw.name === "string" &&
    typeof raw.low === "number" &&
    typeof raw.high === "number"
  );
}

function isCategoricalDim(
  raw: Record<string, unknown>,
): raw is CategoricalDim & Record<string, unknown> {
  return typeof raw.name === "string" && Array.isArray(raw.choices);
}

/** Per-round snapshot entry for a single dimension. null = not tuned in that round. */
interface RoundCell {
  round: number;
  dim: Dim | null;
  expanded: boolean;
}

/** Flatten {rounds, space_snapshot} into per-dim timelines. */
function buildTimelines(
  rounds: TuneRound[],
): Map<string, { kind: "numeric" | "categorical"; cells: RoundCell[] }> {
  const timelines = new Map<
    string,
    { kind: "numeric" | "categorical"; cells: RoundCell[] }
  >();

  // Collect every dim name that appears in any snapshot so we can render
  // consistent rows even when a dim joins the search space mid-session.
  const allNames = new Set<string>();
  for (const r of rounds) {
    const snap = r.space_snapshot;
    if (!snap) continue;
    for (const raw of snap) {
      if (typeof raw.name === "string") allNames.add(raw.name);
    }
  }

  for (const name of allNames) {
    const cells: RoundCell[] = [];
    let kind: "numeric" | "categorical" | null = null;

    for (const r of rounds) {
      const snap = r.space_snapshot;
      const raw = snap?.find(
        (d): d is Record<string, unknown> =>
          typeof d === "object" &&
          d !== null &&
          (d as { name?: unknown }).name === name,
      );

      let dim: Dim | null = null;
      if (raw) {
        if (isNumericDim(raw)) {
          dim = {
            name: raw.name,
            type: String(raw.type ?? "float"),
            low: raw.low,
            high: raw.high,
            log: typeof raw.log === "boolean" ? raw.log : undefined,
          };
          kind ??= "numeric";
        } else if (isCategoricalDim(raw)) {
          dim = {
            name: raw.name,
            type: String(raw.type ?? "categorical"),
            choices: raw.choices,
          };
          kind ??= "categorical";
        }
      }

      cells.push({
        round: r.round,
        dim,
        expanded: r.expanded_dims.includes(name),
      });
    }

    if (kind !== null) {
      timelines.set(name, { kind, cells });
    }
  }

  return timelines;
}

function bestValueFor(
  report: BoundaryReport | null | undefined,
  name: string,
): number | null {
  if (!report) return null;
  const dim = report.dims.find((d) => d.name === name);
  if (!dim || dim.best_value === null) return null;
  return typeof dim.best_value === "number" ? dim.best_value : null;
}

function formatBound(x: number): string {
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 0.01 && abs < 10000) return x.toFixed(4);
  return x.toExponential(2);
}

interface NumericBarProps {
  dim: NumericDim;
  globalLow: number;
  globalHigh: number;
  round: number;
  expanded: boolean;
  bestValue: number | null;
}

function NumericBar({
  dim,
  globalLow,
  globalHigh,
  round,
  expanded,
  bestValue,
}: NumericBarProps) {
  const span = globalHigh - globalLow || 1;
  const leftPct = ((dim.low - globalLow) / span) * 100;
  const widthPct = ((dim.high - dim.low) / span) * 100;
  const label = `Round ${round}: [${formatBound(dim.low)}, ${formatBound(dim.high)}]${dim.log ? " (log)" : ""}${expanded ? ` — expanded in round ${round}` : ""}`;
  const bestLeftPct =
    bestValue !== null && bestValue >= dim.low && bestValue <= dim.high
      ? ((bestValue - globalLow) / span) * 100
      : null;

  return (
    <div
      data-testid="evolution-bar"
      role="img"
      aria-label={label}
      title={label}
      className="relative h-3 w-full rounded-sm bg-muted/40"
    >
      <div
        className={
          expanded
            ? "absolute h-full rounded-sm bg-primary/80 border border-primary"
            : "absolute h-full rounded-sm bg-primary/40"
        }
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
      {bestLeftPct !== null && (
        <div
          aria-hidden="true"
          className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-amber-500"
          style={{ left: `${bestLeftPct}%` }}
        />
      )}
    </div>
  );
}

export function SearchSpaceEvolutionPanel({
  rounds,
  boundaryReport,
}: SearchSpaceEvolutionPanelProps) {
  if (!rounds || rounds.length === 0) return null;

  const timelines = buildTimelines(rounds);
  if (timelines.size === 0) return null;

  return (
    <section className="rounded-md border bg-card p-2">
      <h3 className="text-sm font-medium mb-2 px-1">Search space evolution</h3>
      <div className="space-y-3">
        {[...timelines.entries()].map(([name, { kind, cells }]) => {
          const bestValue = bestValueFor(boundaryReport, name);

          // For numeric dims, compute a shared axis across every populated
          // round so the bars are visually comparable.
          let globalLow = Number.POSITIVE_INFINITY;
          let globalHigh = Number.NEGATIVE_INFINITY;
          for (const cell of cells) {
            if (cell.dim && isNumericDimPure(cell.dim)) {
              globalLow = Math.min(globalLow, cell.dim.low);
              globalHigh = Math.max(globalHigh, cell.dim.high);
            }
          }
          if (!Number.isFinite(globalLow) || !Number.isFinite(globalHigh)) {
            globalLow = 0;
            globalHigh = 1;
          }

          return (
            <div
              key={name}
              data-testid={`evolution-row-${name}`}
              className="grid grid-cols-[minmax(110px,140px)_1fr] gap-3 items-start"
            >
              <div className="text-xs font-mono text-muted-foreground pt-0.5 break-all">
                {name}
                {bestValue !== null && (
                  <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                    best = {formatBound(bestValue)}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {cells.map((cell) => {
                  if (cell.dim === null) {
                    return (
                      <div
                        key={cell.round}
                        className="text-[10px] text-muted-foreground italic"
                      >
                        not tuned in round {cell.round}
                      </div>
                    );
                  }
                  if (kind === "numeric" && isNumericDimPure(cell.dim)) {
                    return (
                      <NumericBar
                        key={cell.round}
                        dim={cell.dim}
                        globalLow={globalLow}
                        globalHigh={globalHigh}
                        round={cell.round}
                        expanded={cell.expanded}
                        bestValue={bestValue}
                      />
                    );
                  }
                  if (
                    kind === "categorical" &&
                    isCategoricalDimPure(cell.dim)
                  ) {
                    const label = `Round ${cell.round}${cell.expanded ? " — expanded" : ""}`;
                    return (
                      <div
                        key={cell.round}
                        className="flex flex-wrap gap-1 text-xs"
                        title={label}
                      >
                        <span className="text-[10px] text-muted-foreground w-12 shrink-0">
                          R{cell.round}
                        </span>
                        {cell.dim.choices.map((choice, idx) => (
                          <span
                            key={`${cell.round}-${idx}`}
                            className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono"
                          >
                            {String(choice)}
                          </span>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- Narrower type guards used inside the render loop to keep TS happy ---

function isNumericDimPure(dim: Dim): dim is NumericDim {
  return (
    typeof (dim as NumericDim).low === "number" &&
    typeof (dim as NumericDim).high === "number"
  );
}

function isCategoricalDimPure(dim: Dim): dim is CategoricalDim {
  return Array.isArray((dim as CategoricalDim).choices);
}
