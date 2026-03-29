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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
    const name = prompt("Preset name:");
    if (!name?.trim()) return;
    savePreset(name.trim(), config);
    toast.success(`Preset "${name.trim()}" saved`);
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
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "fit" | "tune")}
          >
            <TabsList className="w-auto">
              <TabsTrigger value="fit" className="px-6">
                Fit
              </TabsTrigger>
              <TabsTrigger value="tune" className="px-6">
                Tune
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  className="h-9"
                  onClick={activeTab === "fit" ? onFit : onTune}
                  disabled={activeTab === "fit" ? !fitEnabled : !tuneEnabled}
                >
                  {activeTab === "fit" ? "Fit" : "Tune"}
                </Button>
              </span>
            </TooltipTrigger>
            {disabledReason && (
              <TooltipContent>{disabledReason}</TooltipContent>
            )}
          </Tooltip>
        </div>
        {backend && (
          <Badge variant="secondary" className="mt-1.5 text-xs">
            {backend.name} v{backend.version}
          </Badge>
        )}
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
            <div className="space-y-3" data-testid="config-skeleton">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-full" />
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

        {/* Config Actions */}
        <div className="mt-6 flex flex-wrap gap-2">
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleUndo}
            disabled={!history.canUndo}
            aria-label="Undo"
          >
            <Undo2 className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRedo}
            disabled={!history.canRedo}
            aria-label="Redo"
          >
            <Redo2 className="h-3 w-3" />
          </Button>
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
    </div>
  );
}
