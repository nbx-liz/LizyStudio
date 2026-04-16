import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import type { ColumnInfo, ColumnStatsResponse } from "@/api/types";
import { fetchColumnStats } from "@/api/workspace";
import type { ColumnOverride } from "./useDataPanel.types";

interface UseColumnOverridesParams {
  columns: ColumnInfo[];
  target: string | null;
}

export function useColumnOverrides({
  columns,
  target,
}: UseColumnOverridesParams) {
  const [overrides, setOverrides] = useState<Record<string, ColumnOverride>>(
    {},
  );
  const [columnFilter, setColumnFilter] = useState("");
  const [expandedCol, setExpandedCol] = useState<string | null>(null);
  const [colStats, setColStats] = useState<Record<string, ColumnStatsResponse>>(
    {},
  );

  const handleExcludeToggle = (colName: string, checked: boolean) => {
    setOverrides((prev) => ({
      ...prev,
      [colName]: { ...prev[colName], excluded: checked },
    }));
  };

  const handleTypeChange = (
    colName: string,
    type: "numeric" | "categorical",
  ) => {
    setOverrides((prev) => ({
      ...prev,
      [colName]: { ...prev[colName], type },
    }));
  };

  const handleColumnExpand = useCallback(
    async (colName: string) => {
      if (expandedCol === colName) {
        setExpandedCol(null);
        return;
      }
      setExpandedCol(colName);
      if (!colStats[colName]) {
        try {
          const stats = await fetchColumnStats(colName);
          setColStats((prev) => ({ ...prev, [colName]: stats }));
        } catch (err) {
          toast.error(`Failed to load column stats: ${getErrorMessage(err)}`);
        }
      }
    },
    [expandedCol, colStats],
  );

  const summary = useMemo(() => {
    const nonTarget = columns.filter((c) => c.name !== target);
    const total = nonTarget.length;
    const excludedCols = nonTarget.filter((c) => overrides[c.name]?.excluded);
    const included = nonTarget.filter((c) => !overrides[c.name]?.excluded);
    const numeric = included.filter(
      (c) => (overrides[c.name]?.type ?? c.suggested_type) === "numeric",
    );
    const categorical = included.filter(
      (c) => (overrides[c.name]?.type ?? c.suggested_type) === "categorical",
    );
    const idCount = excludedCols.filter(
      (c) => columns.find((cc) => cc.name === c.name)?.exclude_reason === "id",
    ).length;
    const constCount = excludedCols.filter(
      (c) =>
        columns.find((cc) => cc.name === c.name)?.exclude_reason === "constant",
    ).length;
    const manualCount = excludedCols.length - idCount - constCount;
    return {
      total,
      numeric: numeric.length,
      categorical: categorical.length,
      excluded: excludedCols.length,
      idCount,
      constCount,
      manualCount,
    };
  }, [columns, overrides, target]);

  const nonExcludedCols = useMemo(
    () =>
      columns.filter((c) => c.name !== target && !overrides[c.name]?.excluded),
    [columns, target, overrides],
  );

  return {
    overrides,
    setOverrides,
    columnFilter,
    setColumnFilter,
    expandedCol,
    colStats,
    summary,
    nonExcludedCols,
    handleExcludeToggle,
    handleTypeChange,
    handleColumnExpand,
  };
}
