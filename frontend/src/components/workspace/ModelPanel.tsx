import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileText,
  FileUp,
  Info,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import type { ConfigError } from "@/api/types";
import {
  fetchBackends,
  fetchColumns,
  fetchConfig,
  fetchConfigSchema,
  fetchUiSchema,
  getConfigDownloadUrl,
  updateConfig,
  uploadConfig,
  validateConfig,
} from "@/api/workspace";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConfigHistory } from "@/hooks/useConfigHistory";
import { useConfigPresets } from "@/hooks/useConfigPresets";
import { ConfigForm } from "./ConfigForm";
import { RawConfigDialog } from "./RawConfigDialog";
import { SavePresetDialog } from "./SavePresetDialog";
import { TuneTab } from "./TuneTab";

interface ModelPanelProps {
  hasData: boolean;
  task: string | null;
  onFit: () => void;
  onTune: () => void;
  running: boolean;
  activeTab?: "fit" | "tune";
  onActiveTabChange?: (tab: "fit" | "tune") => void;
}

export function ModelPanel({
  hasData,
  task,
  onFit,
  onTune,
  running,
  activeTab: controlledTab,
  onActiveTabChange,
}: ModelPanelProps) {
  const [internalTab, setInternalTab] = useState<"fit" | "tune">("fit");
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: "fit" | "tune") => {
    setInternalTab(tab);
    onActiveTabChange?.(tab);
  };
  const [errors, setErrors] = useState<ConfigError[]>([]);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const history = useConfigHistory();
  const { presets, save: savePreset, load: loadPreset } = useConfigPresets();

  const { data: schema } = useQuery({
    queryKey: ["config-schema"],
    queryFn: fetchConfigSchema,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
  });

  const { data: backends } = useQuery({
    queryKey: ["backends"],
    queryFn: fetchBackends,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const backend = backends?.[0];

  const { data: uiSchema } = useQuery({
    queryKey: ["ui-schema"],
    queryFn: fetchUiSchema,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { data: columnsData } = useQuery({
    queryKey: ["columns"],
    queryFn: () => fetchColumns(),
    enabled: hasData,
  });

  const nonExcludedColumns = useMemo(() => {
    if (!columnsData?.columns) return [];
    return columnsData.columns
      .filter((c) => !c.suggested_excluded)
      .map((c) => c.name);
  }, [columnsData]);

  // Debounced validation
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const handleConfigChange = useCallback(
    async (newConfig: Record<string, unknown>) => {
      if (running) return;
      // Issue #107: deep-equal guard against duplicate PUTs. When
      // useDataPanel.handleTargetChange broadcasts the merged config into
      // the query cache, ConfigForm's task/metric auto-select effect can
      // re-fire with an identical body on the next render. Without this
      // guard the duplicate PUT races the upstream flow and briefly
      // resurfaces the transient 'Field required' validation error the
      // broadcast was meant to prevent. JSON.stringify is sufficient here
      // because the config shape is a plain JSON object produced by
      // setNestedValue, so key order is stable.
      const cached = queryClient.getQueryData<Record<string, unknown>>([
        "config",
      ]);
      if (cached && JSON.stringify(cached) === JSON.stringify(newConfig)) {
        return;
      }
      try {
        await updateConfig(newConfig);
        queryClient.setQueryData(["config"], newConfig);
        history.push(newConfig);
      } catch {
        toast.error("Failed to update config");
        return;
      }

      clearTimeout(validateTimer.current);
      validateTimer.current = setTimeout(async () => {
        try {
          const result = await validateConfig(newConfig);
          setErrors(result.errors);
        } catch {
          // silent
        }
      }, 500);
    },
    [queryClient, running, history.push],
  );

  useEffect(() => {
    return () => clearTimeout(validateTimer.current);
  }, []);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadConfig(file);
      setErrors(result.errors);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toast.success("Config imported");
    } catch (err) {
      toast.error(`Import failed: ${getErrorMessage(err)}`);
    }
    e.target.value = "";
  };

  const handleExport = () => {
    window.open(getConfigDownloadUrl(), "_blank");
  };

  const handleUndo = useCallback(async () => {
    const prev = history.undo();
    if (!prev) return;
    try {
      await updateConfig(prev);
      queryClient.setQueryData(["config"], prev);
      toast.info("Config undone");
    } catch {
      toast.error("Undo failed");
    }
  }, [history, queryClient]);

  const handleRedo = useCallback(async () => {
    const next = history.redo();
    if (!next) return;
    try {
      await updateConfig(next);
      queryClient.setQueryData(["config"], next);
      toast.info("Config redone");
    } catch {
      toast.error("Redo failed");
    }
  }, [history, queryClient]);

  const handleSavePreset = () => {
    if (!config) return;
    setSavePresetOpen(true);
  };

  const confirmSavePreset = (name: string) => {
    if (!config) return;
    savePreset(name, config);
    toast.success(`Preset "${name}" saved`);
  };

  const handleLoadPreset = (name: string) => {
    const preset = loadPreset(name);
    if (!preset) return;
    handleConfigChange(preset);
    toast.success(`Preset "${name}" loaded`);
  };

  const fitEnabled = hasData && !!config && !running && errors.length === 0;
  // Tune enabled: allow empty space if capability flag is set
  const allowEmptySpace =
    uiSchema?.capabilities?.tune?.allow_empty_space === true;
  const tuningSpace =
    ((
      (config?.tuning as Record<string, unknown> | undefined)?.optuna as
        | Record<string, unknown>
        | undefined
    )?.space as Record<string, unknown> | undefined) ?? {};
  const tuneEnabled =
    fitEnabled && (allowEmptySpace || Object.keys(tuningSpace).length > 0);

  const disabledReason = (() => {
    if (running) return "A job is currently running";
    if (!hasData) return "Load data first";
    if (!config) return "Loading configuration...";
    if (errors.length > 0) return "Fix validation errors first";
    if (activeTab === "tune" && !tuneEnabled)
      return "Define a search space or enable empty space";
    return null;
  })();

  return (
    <div className="flex h-full flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 border-b bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Model
            </span>
            {backend && (
              <span className="text-[10px] text-muted-foreground">
                {backend.name} v{backend.version}
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "fit" | "tune")}
          >
            <TabsList variant="line" className="h-9 w-auto">
              <TabsTrigger value="fit" className="px-6">
                Fit
              </TabsTrigger>
              <TabsTrigger value="tune" className="px-6">
                Tune
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2 min-w-0">
            {disabledReason && (
              <span className="truncate text-[11px] text-muted-foreground max-w-[180px]">
                {disabledReason}
              </span>
            )}
            <Button
              size="sm"
              className="h-9 shrink-0"
              onClick={activeTab === "fit" ? onFit : onTune}
              disabled={activeTab === "fit" ? !fitEnabled : !tuneEnabled}
            >
              {running ? "Running..." : activeTab === "fit" ? "Fit" : "Tune"}
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto p-4">
        {running && (
          <output
            className="mb-4 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950"
            data-testid="running-info-bar"
          >
            <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <p className="text-xs text-blue-800 dark:text-blue-200">
              A job is currently running. Configuration is locked until the job
              completes.
            </p>
          </output>
        )}
        {hasData && errors.length > 0 && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            {errors
              .filter((err) => err.path || err.message)
              .map((err, i) => (
                <p key={`err-${i}`} className="text-xs text-destructive">
                  {[err.path, err.message].filter(Boolean).join(": ")}
                </p>
              ))}
          </div>
        )}

        <div
          className={running ? "pointer-events-none opacity-60" : undefined}
          data-testid="config-form-area"
          aria-disabled={running}
        >
          {activeTab === "fit" ? (
            schema && config ? (
              <ConfigForm
                schema={schema}
                config={config}
                onChange={handleConfigChange}
                task={task}
                uiSchema={uiSchema}
                columns={nonExcludedColumns}
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground"
                data-testid="config-guidance"
              >
                <p className="text-sm">
                  {hasData
                    ? "Loading configuration..."
                    : "Load data in the Data Panel to configure your model."}
                </p>
              </div>
            )
          ) : config ? (
            <TuneTab
              config={config}
              onChange={handleConfigChange}
              task={task}
              uiSchema={uiSchema}
              columns={nonExcludedColumns}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Loading config...</p>
          )}
        </div>
      </div>

      {/* Config Actions — sticky footer */}
      <div
        className={`shrink-0 border-t bg-background px-4 py-3${running ? " pointer-events-none opacity-60" : ""}`}
        aria-disabled={running}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={running}
          >
            <FileUp className="mr-1 h-3 w-3" />
            Import YAML
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,.json"
            className="hidden"
            onChange={handleImport}
          />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1 h-3 w-3" />
            Export YAML
          </Button>

          <div className="h-4 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                disabled={!history.canUndo}
                aria-label="Undo"
              >
                <Undo2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRedo}
                disabled={!history.canRedo}
                aria-label="Redo"
              >
                <Redo2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo</TooltipContent>
          </Tooltip>

          <div className="h-4 w-px bg-border" />

          <Button variant="outline" size="sm" onClick={handleSavePreset}>
            <Save className="mr-1 h-3 w-3" />
            Save Preset
          </Button>
          {presets.length > 0 && (
            <Select onValueChange={handleLoadPreset}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Load Preset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <RawConfigDialog
            config={config}
            trigger={
              <Button variant="outline" size="sm">
                <FileText className="mr-1 h-3 w-3" />
                Raw Config
              </Button>
            }
          />
        </div>
      </div>
      <SavePresetDialog
        open={savePresetOpen}
        onOpenChange={setSavePresetOpen}
        onSave={confirmSavePreset}
        existingNames={presets.map((p) => p.name)}
      />
    </div>
  );
}
