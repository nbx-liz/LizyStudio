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
}: ColumnSettingsSectionProps) {
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
          <div className="max-h-64 overflow-auto rounded border">
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
            {columns
              .filter((c) => c.name !== target)
              .filter((c) =>
                columnFilter
                  ? c.name.toLowerCase().includes(columnFilter.toLowerCase())
                  : true,
              )
              .map((col, idx) => {
                const o = overrides[col.name];
                const isExcluded = o?.excluded ?? false;
                const currentType = o?.type ?? col.suggested_type;
                const isExpanded = expandedCol === col.name;
                const stats = colStats[col.name];
                return (
                  <div key={col.name}>
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
                      className={`grid w-full grid-cols-[1fr_60px_60px_100px] items-center gap-x-2 px-3 py-1.5 text-left hover:bg-muted/40 cursor-pointer ${idx % 2 === 1 ? "bg-muted/20" : ""}`}
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
                        />
                      </div>
                      {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation container */}
                      <div
                        className="flex gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant={
                            currentType === "numeric" ? "default" : "outline"
                          }
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          disabled={isExcluded}
                          onClick={() => onTypeChange(col.name, "numeric")}
                        >
                          Num
                        </Button>
                        <Button
                          variant={
                            currentType === "categorical"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          disabled={isExcluded}
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
              })}
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
