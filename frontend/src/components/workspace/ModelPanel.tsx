import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FileUp, Redo2, Save, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { TuneTab } from "./TuneTab";

interface ModelPanelProps {
  hasData: boolean;
  task: string | null;
  onFit: () => void;
  onTune: () => void;
  running: boolean;
}

export function ModelPanel({
  hasData,
  task,
  onFit,
  onTune,
  running,
}: ModelPanelProps) {
  const [activeTab, setActiveTab] = useState<"fit" | "tune">("fit");
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [errors, setErrors] = useState<ConfigError[]>([]);
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
        } catch (err) {
          // Validation network errors are non-fatal but logged for debugging
          console.warn("Config validation failed:", err);
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
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
    setPresetName("");
    setPresetDialogOpen(true);
  };

  const confirmSavePreset = () => {
    if (!config || !presetName.trim()) return;
    savePreset(presetName.trim(), config);
    toast.success(`Preset "${presetName.trim()}" saved`);
    setPresetDialogOpen(false);
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
            <TabsList className="h-9 w-auto">
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
              {activeTab === "fit" ? "Fit" : "Tune"}
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto p-4">
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
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading config...</p>
        )}
      </div>

      {/* Config Actions — sticky footer */}
      <div className="shrink-0 border-t bg-background px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
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

      {/* Save Preset Dialog */}
      <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save Preset</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Preset name"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmSavePreset();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPresetDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={confirmSavePreset}
              disabled={!presetName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
