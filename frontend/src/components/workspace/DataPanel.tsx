import { forwardRef, useImperativeHandle } from "react";
import type { UiSchema } from "@/api/types";
import { fetchConfig } from "@/api/workspace";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildSyncedConfig } from "@/hooks/buildSyncedConfig";
import {
  TASK_OPTIONS,
  type TaskType,
  useDataPanel,
} from "@/hooks/useDataPanel";
import { ColumnSettingsSection } from "./ColumnSettingsSection";
import { CvSection } from "./CvSection";
import { DataSourceSection } from "./DataSourceSection";
import { FoldPreview } from "./FoldPreview";
import { SegmentGroup } from "./SegmentGroup";

interface DataPanelProps {
  onDataChanged: () => void;
  onTaskChanged?: (task: string | null) => void;
  uiSchema?: UiSchema;
}

/**
 * Imperative handle exposed by :class:`DataPanel` so the Fit/Tune
 * handler in ``WorkspacePage`` can grab the **latest** merged config
 * at click time (P-0086, Issue #251).
 *
 * The alternative of lifting every piece of :func:`useDataPanel` state
 * up one level would require threading 25+ controlled-component props
 * through DataPanel, exploding the surface area. The ref keeps the
 * interface small: one function that returns the snapshot a POST /fit
 * or /tune body should carry.
 */
export interface DataPanelHandle {
  getSubmitConfig: () => Promise<Record<string, unknown>>;
}

export const DataPanel = forwardRef<DataPanelHandle, DataPanelProps>(
  function DataPanel(
    { onDataChanged, onTaskChanged, uiSchema }: DataPanelProps,
    ref,
  ) {
    const {
      sourceType,
      setSourceType,
      dataPath,
      setDataPath,
      shape,
      preview,
      target,
      task,
      allColumnNames,
      columns,
      overrides,
      cv,
      setCv,
      blocked,
      setBlocked,
      loading,
      columnFilter,
      setColumnFilter,
      expandedCol,
      colStats,
      summary,
      nonExcludedCols,
      handleLoadPathByValue,
      handleUpload,
      handleTargetChange,
      handleTaskChange,
      handleExcludeToggle,
      handleTypeChange,
      handleColumnExpand,
    } = useDataPanel({ onDataChanged, onTaskChanged, uiSchema });

    // P-0086: expose a builder that returns the merged config the Fit/Tune
    // handler should post. ``base`` is re-fetched on each call so the
    // merge runs against the freshest server-known snapshot, but the
    // overlay (target / task / overrides / cv / blocked) comes from
    // current React state — i.e. what the user actually sees.
    const strategyFields = uiSchema?.capabilities?.cv_strategy_fields?.[
      cv.strategy
    ] as readonly string[] | undefined;
    useImperativeHandle(
      ref,
      () => ({
        getSubmitConfig: async () => {
          const base = await fetchConfig();
          return buildSyncedConfig({
            base: base as Record<string, unknown>,
            dataPath,
            target,
            task,
            overrides,
            cv,
            blocked,
            strategyFields,
          });
        },
      }),
      [dataPath, target, task, overrides, cv, blocked, strategyFields],
    );

    return (
      <div className="flex h-full flex-col overflow-auto">
        <div className="px-3 py-4">
          <Accordion
            type="multiple"
            defaultValue={["source", "target", "columns", "cv"]}
          >
            {/* Data Source */}
            <AccordionItem value="source" className="border-b">
              <AccordionTrigger className="py-1.5 text-sm font-semibold hover:bg-muted/50">
                Data Source
              </AccordionTrigger>
              <AccordionContent>
                <DataSourceSection
                  sourceType={sourceType}
                  onSourceTypeChange={setSourceType}
                  dataPath={dataPath}
                  onDataPathChange={setDataPath}
                  loading={loading}
                  shape={shape}
                  preview={preview}
                  onLoadPath={handleLoadPathByValue}
                  onUpload={handleUpload}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Target / Task */}
            <AccordionItem value="target" className="border-b">
              <AccordionTrigger className="py-1.5 text-sm font-semibold hover:bg-muted/50">
                Target / Task
              </AccordionTrigger>
              <AccordionContent>
                <div className="lzs-form space-y-3 pl-4">
                  <div className="flex items-center gap-2">
                    <Label className="min-w-[60px] text-xs">Target</Label>
                    <Select
                      value={target ?? ""}
                      onValueChange={handleTargetChange}
                      disabled={allColumnNames.length === 0}
                    >
                      <SelectTrigger
                        aria-label="Target column"
                        className="h-8 flex-1"
                      >
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
                  <div className="flex items-start gap-2">
                    <Label className="mt-1 min-w-[60px] text-xs">Task</Label>
                    <div className="flex flex-col gap-1">
                      <SegmentGroup
                        options={TASK_OPTIONS as unknown as string[]}
                        value={task ?? ""}
                        onChange={(v) => handleTaskChange(v as TaskType)}
                        disabled={!target}
                      />
                      {!target && (
                        <span className="text-xs text-muted-foreground">
                          Auto-detected after target selection
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Column Settings */}
            <AccordionItem value="columns" className="border-b">
              <AccordionTrigger className="py-1.5 text-sm font-semibold hover:bg-muted/50">
                <span className="flex items-center gap-2">
                  Column Settings
                  {target && columns.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-normal"
                    >
                      {summary.total - summary.excluded} features
                    </Badge>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <ColumnSettingsSection
                  columns={columns}
                  target={target}
                  overrides={overrides}
                  columnFilter={columnFilter}
                  onColumnFilterChange={setColumnFilter}
                  expandedCol={expandedCol}
                  colStats={colStats}
                  summary={summary}
                  onExcludeToggle={handleExcludeToggle}
                  onTypeChange={handleTypeChange}
                  onColumnExpand={handleColumnExpand}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Cross Validation */}
            <AccordionItem value="cv" className="border-b">
              <AccordionTrigger className="py-1.5 text-sm font-semibold hover:bg-muted/50">
                Cross Validation
              </AccordionTrigger>
              <AccordionContent>
                <div className="pl-4 space-y-3">
                  <CvSection
                    cv={cv}
                    onChange={setCv}
                    uiSchema={uiSchema}
                    nonExcludedCols={nonExcludedCols}
                    blocked={blocked}
                    onBlockedChange={setBlocked}
                    nRows={shape ? shape[0] : undefined}
                  />
                  <FoldPreview
                    enabled={!!target && !!task && shape !== null}
                    cvKey={JSON.stringify({
                      strategy: cv.strategy,
                      folds: cv.folds,
                      gap: cv.gap,
                    })}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    );
  },
);
