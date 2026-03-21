import { Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ColumnInfo, UiSchema } from "@/api/types";
import {
  fetchColumns,
  fetchConfig,
  fetchConfigDefaults,
  fetchPreview,
  loadDataFromPath,
  updateConfig,
  uploadData,
} from "@/api/workspace";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applyCvDataFields,
  buildSplitConfig,
  CvSection,
  type CvState,
  INITIAL_CV_STATE,
  resetCvState,
} from "./CvSection";
import { getDefaultCvStrategy } from "./constants";
import { FileBrowser } from "./FileBrowser";

type SourceType = "path" | "upload";
type TaskType = "binary" | "multiclass" | "regression";

const TASK_OPTIONS: TaskType[] = ["binary", "multiclass", "regression"];

interface ColumnOverride {
  excluded: boolean;
  type: "numeric" | "categorical";
}

interface DataPanelProps {
  onDataChanged: () => void;
  onTaskChanged?: (task: string | null) => void;
  uiSchema?: UiSchema;
}

export function DataPanel({
  onDataChanged,
  onTaskChanged,
  uiSchema,
}: DataPanelProps) {
  const [sourceType, setSourceType] = useState<SourceType>("upload");
  const [dataPath, setDataPath] = useState("");
  const [shape, setShape] = useState<[number, number] | null>(null);
  const [preview, setPreview] = useState<{
    columns: string[];
    data: Record<string, unknown>[];
  } | null>(null);

  const [target, setTarget] = useState<string | null>(null);
  const [task, setTask] = useState<TaskType | null>(null);
  const [allColumnNames, setAllColumnNames] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ColumnOverride>>(
    {},
  );

  const [cv, setCv] = useState<CvState>(INITIAL_CV_STATE);
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const syncConfig = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const categorical = Object.entries(overrides)
        .filter(([, v]) => !v.excluded && v.type === "categorical")
        .map(([k]) => k);
      const excluded = Object.entries(overrides)
        .filter(([, v]) => v.excluded)
        .map(([k]) => k);

      const base = await fetchConfig({ signal: controller.signal });
      if (controller.signal.aborted) return;

      const baseData = (base as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      const merged: Record<string, unknown> = {
        ...base,
        task: task || (base as Record<string, unknown>).task,
        data: applyCvDataFields(
          {
            ...baseData,
            path: dataPath || undefined,
            target: target || undefined,
          },
          cv,
        ),
        features: {
          ...((base as Record<string, unknown>).features as object),
          categorical,
          exclude: excluded,
        },
        split: buildSplitConfig(cv),
      };
      await updateConfig(merged, { signal: controller.signal });
      if (controller.signal.aborted) return;
      onDataChanged();
    } catch {
      // silent — config sync errors are non-fatal
    }
  }, [dataPath, target, task, overrides, cv, onDataChanged]);

  const prevSyncKey = useRef("");
  useEffect(() => {
    if (!target) return;
    const key = JSON.stringify({ target, task, overrides, cv });
    if (key === prevSyncKey.current) return;
    prevSyncKey.current = key;
    syncConfig();
  }, [target, task, overrides, cv, syncConfig]);

  const handleLoadPathByValue = async (path: string) => {
    if (!path.trim()) return;
    setLoading(true);
    try {
      const res = await loadDataFromPath(path);
      setShape(res.data_ref.shape);
      const prev = await fetchPreview(5);
      setPreview(prev);
      const cols = await fetchColumns();
      setColumns(cols.columns);
      setAllColumnNames(cols.columns.map((c) => c.name));
      setTarget(null);
      setTask(null);
      setOverrides({});
      onTaskChanged?.(null);
      onDataChanged();
      toast.success(
        `Data loaded: ${res.data_ref.shape[0]} rows x ${res.data_ref.shape[1]} columns`,
      );
    } catch (err) {
      toast.error(
        `Failed to load data: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const res = await uploadData(file);
      setShape(res.data_ref.shape);
      setDataPath(res.data_ref.path);
      const prev = await fetchPreview(5);
      setPreview(prev);
      const cols = await fetchColumns();
      setColumns(cols.columns);
      setAllColumnNames(cols.columns.map((c) => c.name));
      setTarget(null);
      setTask(null);
      setOverrides({});
      onTaskChanged?.(null);
      onDataChanged();
      toast.success(`Uploaded: ${file.name}`);
    } catch (err) {
      toast.error(
        `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTargetChange = useCallback(
    async (value: string) => {
      setTarget(value);
      try {
        const cols = await fetchColumns(value);
        setColumns(cols.columns);

        let detectedTask: TaskType | null = task;
        let detectedStrategy = cv.strategy;
        if (cols.suggested_task) {
          const t = cols.suggested_task as TaskType;
          detectedTask = t;
          setTask(t);
          onTaskChanged?.(t);
          detectedStrategy = getDefaultCvStrategy(t);
          setCv(resetCvState(detectedStrategy));
        }

        const newOverrides: Record<string, ColumnOverride> = {};
        for (const col of cols.columns) {
          newOverrides[col.name] = {
            excluded: col.suggested_excluded,
            type: col.suggested_type,
          };
        }
        setOverrides(newOverrides);

        if (detectedTask) {
          const defaults = await fetchConfigDefaults(detectedTask, value);
          const categorical = Object.entries(newOverrides)
            .filter(([, v]) => !v.excluded && v.type === "categorical")
            .map(([k]) => k);
          const excluded = Object.entries(newOverrides)
            .filter(([, v]) => v.excluded)
            .map(([k]) => k);
          const merged: Record<string, unknown> = {
            ...defaults,
            task: detectedTask,
            data: {
              ...(defaults.data as object),
              path: dataPath || undefined,
              target: value,
            },
            features: {
              ...(defaults.features as object),
              categorical,
              exclude: excluded,
            },
            split: {
              method: detectedStrategy,
              n_splits: cv.folds,
            },
          };
          await updateConfig(merged);
          onDataChanged();
        }
      } catch (err) {
        toast.error(
          `Column detection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [task, cv, dataPath, onDataChanged, onTaskChanged],
  );

  const handleTaskChange = (newTask: TaskType) => {
    setTask(newTask);
    onTaskChanged?.(newTask);
    setCv(resetCvState(getDefaultCvStrategy(newTask)));
  };

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

  const nonExcludedCols = columns.filter(
    (c) => c.name !== target && !overrides[c.name]?.excluded,
  );

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="p-4">
        <Accordion
          type="multiple"
          defaultValue={["source", "target", "columns", "cv"]}
        >
          {/* Data Source */}
          <AccordionItem value="source">
            <AccordionTrigger>Data Source</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={sourceType === "path" ? "default" : "outline"}
                    onClick={() => setSourceType("path")}
                  >
                    Path
                  </Button>
                  <Button
                    size="sm"
                    variant={sourceType === "upload" ? "default" : "outline"}
                    onClick={() => setSourceType("upload")}
                  >
                    Upload
                  </Button>
                </div>
                {sourceType === "path" ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="/path/to/data.csv"
                        value={dataPath}
                        onChange={(e) => setDataPath(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleLoadPathByValue(dataPath);
                          }
                        }}
                        className="h-8 text-sm"
                      />
                      <FileBrowser
                        onSelect={(path) => {
                          setDataPath(path);
                          handleLoadPathByValue(path);
                        }}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!dataPath.trim() || loading}
                      onClick={() => handleLoadPathByValue(dataPath)}
                    >
                      Load
                    </Button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-sm text-muted-foreground hover:border-primary/50">
                    <Upload className="h-8 w-8" />
                    <span>Drop CSV/Parquet or click to upload</span>
                    <input
                      type="file"
                      accept=".csv,.parquet"
                      className="hidden"
                      onChange={handleUpload}
                    />
                  </label>
                )}
                {loading && (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                )}
                {shape && !loading && (
                  <p className="text-sm text-muted-foreground">
                    {shape[0]} rows x {shape[1]} columns
                  </p>
                )}
                {preview && preview.data.length > 0 && (
                  <div className="max-h-40 overflow-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {preview.columns.map((col) => (
                            <TableHead key={col} className="text-xs">
                              {col}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.data.map((row, i) => (
                          <TableRow key={`row-${i}`}>
                            {preview.columns.map((col) => (
                              <TableCell key={col} className="text-xs">
                                {String(row[col] ?? "")}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Target / Task */}
          <AccordionItem value="target">
            <AccordionTrigger>Target / Task</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div>
                  <Label>Target</Label>
                  <Select
                    value={target ?? ""}
                    onValueChange={handleTargetChange}
                    disabled={allColumnNames.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select target column" />
                    </SelectTrigger>
                    <SelectContent>
                      {allColumnNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Task</Label>
                  <div className="flex gap-1 pt-1">
                    {TASK_OPTIONS.map((t) => (
                      <Button
                        key={t}
                        variant={task === t ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs px-3"
                        onClick={() => handleTaskChange(t)}
                        disabled={!target}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                  {!target && (
                    <span className="text-xs text-muted-foreground">
                      Auto-detected after target selection
                    </span>
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Column Settings */}
          <AccordionItem value="columns">
            <AccordionTrigger>Column Settings</AccordionTrigger>
            <AccordionContent>
              {columns.length > 0 && target ? (
                <div className="max-h-64 overflow-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Column</TableHead>
                        <TableHead className="w-16 text-xs">Uniq</TableHead>
                        <TableHead className="w-12 text-xs">Excl</TableHead>
                        <TableHead className="w-28 text-xs">Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {columns
                        .filter((c) => c.name !== target)
                        .map((col) => {
                          const o = overrides[col.name];
                          const isExcluded = o?.excluded ?? false;
                          const currentType = o?.type ?? col.suggested_type;
                          return (
                            <TableRow key={col.name}>
                              <TableCell className="text-xs">
                                {col.name}
                                {col.exclude_reason === "id" && (
                                  <Badge
                                    variant="outline"
                                    className="ml-1 text-[10px]"
                                  >
                                    ID
                                  </Badge>
                                )}
                                {col.exclude_reason === "constant" && (
                                  <Badge
                                    variant="outline"
                                    className="ml-1 text-[10px]"
                                  >
                                    Const
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-xs">
                                {col.unique_count}
                              </TableCell>
                              <TableCell>
                                <Checkbox
                                  checked={isExcluded}
                                  onCheckedChange={(checked) =>
                                    handleExcludeToggle(
                                      col.name,
                                      checked === true,
                                    )
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-0.5">
                                  <Button
                                    variant={
                                      currentType === "numeric"
                                        ? "default"
                                        : "outline"
                                    }
                                    size="sm"
                                    className="h-6 text-[10px] px-2"
                                    disabled={isExcluded}
                                    onClick={() =>
                                      handleTypeChange(col.name, "numeric")
                                    }
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
                                    onClick={() =>
                                      handleTypeChange(col.name, "categorical")
                                    }
                                  >
                                    Cat
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Load data and select a target first
                </p>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Cross Validation */}
          <AccordionItem value="cv">
            <AccordionTrigger>Cross Validation</AccordionTrigger>
            <AccordionContent>
              <CvSection
                cv={cv}
                onChange={setCv}
                uiSchema={uiSchema}
                nonExcludedCols={nonExcludedCols}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Feature Summary */}
        {target && columns.length > 0 && (
          <div className="mt-4 rounded-md border bg-muted/50 p-3 text-sm">
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
    </div>
  );
}
