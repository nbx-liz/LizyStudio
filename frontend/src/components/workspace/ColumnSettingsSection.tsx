import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import type { ColumnInfo, ColumnStatsResponse } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ColumnOverride } from "@/hooks/useDataPanel";
import { DistributionBar } from "./DistributionBar";

interface ColumnSettingsSectionProps {
  columns: ColumnInfo[];
  target: string | null;
  overrides: Record<string, ColumnOverride>;
  columnFilter: string;
  onColumnFilterChange: (v: string) => void;
  expandedCol: string | null;
  colStats: Record<string, ColumnStatsResponse>;
  summary: {
    total: number;
    numeric: number;
    categorical: number;
    excluded: number;
    idCount: number;
    constCount: number;
    manualCount: number;
  };
  onExcludeToggle: (colName: string, checked: boolean) => void;
  onTypeChange: (colName: string, type: "numeric" | "categorical") => void;
  onColumnExpand: (colName: string) => void;
  /**
   * PR-B2 / P-0097: optional bulk handlers used by the wide-DataFrame
   * UX. When provided AND the user has typed a non-empty filter, the
   * toolbar above the row list lets them apply the action to every
   * filtered (non-target) column in a single state update.
   *
   * The handlers are optional so callers that have not migrated yet
   * (Storybook stories, legacy tests) keep working unchanged.
   */
  onBulkExcludeToggle?: (colNames: string[], checked: boolean) => void;
  onBulkTypeChange?: (
    colNames: string[],
    type: "numeric" | "categorical",
  ) => void;
  /**
   * P-0089 / Issue #279: lock the per-column Exclude / Num / Cat
   * controls while a fit/tune job is running. PUT /config returns
   * 409 server-side; disabling the controls here matches that lock
   * so the user does not see optimistic UI flicker followed by a
   * toast.
   */
  disabled?: boolean;
}

const ROW_HEIGHT_PX = 32;
const VIRTUAL_OVERSCAN = 8;
/**
 * PR-B2 / P-0097: only switch on virtualization once the visible
 * column count crosses this threshold. Real-world workspaces with
 * tens of columns get the simpler, fully-mounted list and avoid the
 * react-virtual measurement overhead; wide-DataFrame workspaces
 * (Issue #361) get a windowed list with a constant DOM cost.
 */
const VIRTUAL_COLUMN_THRESHOLD = 200;

interface ColumnRowProps {
  col: ColumnInfo;
  index: number;
  overrides: Record<string, ColumnOverride>;
  expandedCol: string | null;
  colStats: Record<string, ColumnStatsResponse>;
  onExcludeToggle: (colName: string, checked: boolean) => void;
  onTypeChange: (colName: string, type: "numeric" | "categorical") => void;
  onColumnExpand: (colName: string) => void;
  disabled: boolean;
}

function ColumnRow({
  col,
  index,
  overrides,
  expandedCol,
  colStats,
  onExcludeToggle,
  onTypeChange,
  onColumnExpand,
  disabled,
}: ColumnRowProps) {
  const o = overrides[col.name];
  const isExcluded = o?.excluded ?? false;
  const currentType = o?.type ?? col.suggested_type;
  const isExpanded = expandedCol === col.name;
  const stats = colStats[col.name];
  return (
    <div>
      {/* Issue #248: row must not be a <button> because it
          wraps other interactive controls (Checkbox, Num/Cat
          buttons). Real browsers hoist the inner <button>s
          out of the outer one, breaking click handling. Use
          role="button" + tabIndex + keyboard handler so the
          row stays activatable without nesting interactive
          content inside a <button>. */}
      {/* biome-ignore lint/a11y/useSemanticElements: cannot use <button> — nested interactive content */}
      <div
        role="button"
        tabIndex={0}
        aria-label={col.name}
        aria-expanded={isExpanded}
        className={`grid w-full grid-cols-[1fr_60px_60px_100px] items-center gap-x-2 px-3 py-1.5 text-left hover:bg-muted/40 cursor-pointer ${index % 2 === 1 ? "bg-muted/20" : ""}`}
        onClick={() => onColumnExpand(col.name)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onColumnExpand(col.name);
          }
        }}
        data-testid={`column-row-${col.name}`}
      >
        <span className="text-xs truncate">
          {col.name}
          {col.exclude_reason === "id" && (
            <Badge variant="outline" className="ml-1 text-[10px]">
              ID
            </Badge>
          )}
          {col.exclude_reason === "constant" && (
            <Badge variant="outline" className="ml-1 text-[10px]">
              Const
            </Badge>
          )}
        </span>
        <span className="text-xs">{col.unique_count}</span>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation container */}
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={isExcluded}
            onCheckedChange={(checked) =>
              onExcludeToggle(col.name, checked === true)
            }
            disabled={disabled}
          />
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation container */}
        <div
          className="flex gap-0.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Button
            variant={currentType === "numeric" ? "default" : "outline"}
            size="sm"
            className="h-6 text-[10px] px-2"
            disabled={isExcluded || disabled}
            onClick={() => onTypeChange(col.name, "numeric")}
          >
            Num
          </Button>
          <Button
            variant={currentType === "categorical" ? "default" : "outline"}
            size="sm"
            className="h-6 text-[10px] px-2"
            disabled={isExcluded || disabled}
            onClick={() => onTypeChange(col.name, "categorical")}
          >
            Cat
          </Button>
        </div>
      </div>
      {isExpanded && stats && (
        <div
          className="px-3 py-2 bg-muted/10 border-t"
          data-testid={`column-dist-${col.name}`}
        >
          <DistributionBar
            valueCounts={stats.value_counts}
            totalCount={stats.total_count}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            {stats.unique_count} unique, {stats.null_count} null
          </p>
        </div>
      )}
    </div>
  );
}

interface VirtualListProps {
  visibleColumns: ColumnInfo[];
  overrides: Record<string, ColumnOverride>;
  expandedCol: string | null;
  colStats: Record<string, ColumnStatsResponse>;
  onExcludeToggle: (colName: string, checked: boolean) => void;
  onTypeChange: (colName: string, type: "numeric" | "categorical") => void;
  onColumnExpand: (colName: string) => void;
  disabled: boolean;
}

function VirtualColumnList({
  visibleColumns,
  overrides,
  expandedCol,
  colStats,
  onExcludeToggle,
  onTypeChange,
  onColumnExpand,
  disabled,
}: VirtualListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: visibleColumns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      expandedCol && visibleColumns[index]?.name === expandedCol
        ? ROW_HEIGHT_PX + 80
        : ROW_HEIGHT_PX,
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: (index) => visibleColumns[index]?.name ?? index,
    // jsdom returns 0 for getBoundingClientRect; fall back to a fixed
    // viewport so unit tests still mount the visible window. Real
    // browsers ignore this branch because the scroll element measures
    // > 0 immediately.
    initialRect: { width: 800, height: 320 },
  });

  const items = virtualizer.getVirtualItems();
  return (
    <div
      ref={scrollRef}
      className="max-h-64 overflow-auto"
      data-testid="column-virtual-scroll"
    >
      <div
        data-testid="column-virtual-spacer"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {items.map((vRow) => {
          const col = visibleColumns[vRow.index];
          if (!col) return null;
          return (
            <div
              key={col.name}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              <ColumnRow
                col={col}
                index={vRow.index}
                overrides={overrides}
                expandedCol={expandedCol}
                colStats={colStats}
                onExcludeToggle={onExcludeToggle}
                onTypeChange={onTypeChange}
                onColumnExpand={onColumnExpand}
                disabled={disabled}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ColumnSettingsSection({
  columns,
  target,
  overrides,
  columnFilter,
  onColumnFilterChange,
  expandedCol,
  colStats,
  summary,
  onExcludeToggle,
  onTypeChange,
  onColumnExpand,
  onBulkExcludeToggle,
  onBulkTypeChange,
  disabled = false,
}: ColumnSettingsSectionProps) {
  const visibleColumns = useMemo(() => {
    const lc = columnFilter.toLowerCase();
    return columns.filter(
      (c) =>
        c.name !== target && (lc === "" || c.name.toLowerCase().includes(lc)),
    );
  }, [columns, target, columnFilter]);

  const useVirtual = visibleColumns.length > VIRTUAL_COLUMN_THRESHOLD;

  return (
    <div className="pl-4">
      {columns.length > 0 && target ? (
        <>
          <Input
            className="mb-2 h-7 text-xs"
            placeholder="Search columns..."
            value={columnFilter}
            onChange={(e) => onColumnFilterChange(e.target.value)}
            data-testid="column-search"
          />
          {(onBulkExcludeToggle || onBulkTypeChange) &&
            columnFilter !== "" &&
            visibleColumns.length > 0 && (
              <div
                data-testid="column-bulk-toolbar"
                className="mb-2 flex flex-wrap items-center gap-1 rounded-md border border-dashed bg-muted/30 px-2 py-1 text-xs"
              >
                <span className="text-muted-foreground">
                  Apply to {visibleColumns.length} filtered:
                </span>
                {onBulkExcludeToggle && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={disabled}
                      onClick={() =>
                        onBulkExcludeToggle(
                          visibleColumns.map((c) => c.name),
                          true,
                        )
                      }
                    >
                      Exclude filtered
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={disabled}
                      onClick={() =>
                        onBulkExcludeToggle(
                          visibleColumns.map((c) => c.name),
                          false,
                        )
                      }
                    >
                      Include filtered
                    </Button>
                  </>
                )}
                {onBulkTypeChange && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={disabled}
                      onClick={() =>
                        onBulkTypeChange(
                          visibleColumns.map((c) => c.name),
                          "numeric",
                        )
                      }
                    >
                      Set filtered to Numeric
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={disabled}
                      onClick={() =>
                        onBulkTypeChange(
                          visibleColumns.map((c) => c.name),
                          "categorical",
                        )
                      }
                    >
                      Set filtered to Categorical
                    </Button>
                  </>
                )}
              </div>
            )}
          <div className="rounded border">
            <div className="grid grid-cols-[1fr_60px_60px_100px] gap-x-2 px-3 py-1.5 border-b bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground">
                Name
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Unique
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Exclude
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Type
              </span>
            </div>
            {useVirtual ? (
              <VirtualColumnList
                visibleColumns={visibleColumns}
                overrides={overrides}
                expandedCol={expandedCol}
                colStats={colStats}
                onExcludeToggle={onExcludeToggle}
                onTypeChange={onTypeChange}
                onColumnExpand={onColumnExpand}
                disabled={disabled}
              />
            ) : (
              <div className="max-h-64 overflow-auto">
                {visibleColumns.map((col, idx) => (
                  <ColumnRow
                    key={col.name}
                    col={col}
                    index={idx}
                    overrides={overrides}
                    expandedCol={expandedCol}
                    colStats={colStats}
                    onExcludeToggle={onExcludeToggle}
                    onTypeChange={onTypeChange}
                    onColumnExpand={onColumnExpand}
                    disabled={disabled}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Load data and select a target first
        </p>
      )}
      {/* Feature Summary */}
      {target && columns.length > 0 && (
        <div className="mt-3 rounded-md border bg-muted/50 p-2.5 text-xs">
          <p>
            Features: {summary.total - summary.excluded} columns (Numeric:{" "}
            {summary.numeric}, Categorical: {summary.categorical})
          </p>
          <p className="text-muted-foreground">
            Excluded: {summary.excluded} (ID: {summary.idCount}, Const:{" "}
            {summary.constCount}, Manual: {summary.manualCount})
          </p>
        </div>
      )}
    </div>
  );
}
