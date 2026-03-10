import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FileUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ConfigError } from "@/api/types";
import {
  fetchConfig,
  fetchConfigSchema,
  getConfigDownloadUrl,
  updateConfig,
  uploadConfig,
  validateConfig,
} from "@/api/workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfigForm } from "./ConfigForm";

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

  const { data: schema } = useQuery({
    queryKey: ["config-schema"],
    queryFn: fetchConfigSchema,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
  });

  // Debounced validation
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const handleConfigChange = useCallback(
    async (newConfig: Record<string, unknown>) => {
      try {
        await updateConfig(newConfig);
        queryClient.invalidateQueries({ queryKey: ["config"] });
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
    [queryClient],
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

  const fitEnabled = hasData && !!config && !running;
  const tuneEnabled = fitEnabled; // simplified — full check would verify search space

  return (
    <div className="flex h-full flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 border-b bg-background p-3">
        <div className="mb-2 flex items-center justify-end">
          <Button
            size="sm"
            onClick={activeTab === "fit" ? onFit : onTune}
            disabled={activeTab === "fit" ? !fitEnabled : !tuneEnabled}
          >
            {activeTab === "fit" ? "Fit" : "Tune"}
          </Button>
        </div>
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "fit" | "tune")}
        >
          <TabsList className="w-full">
            <TabsTrigger value="fit" className="flex-1">
              Fit
            </TabsTrigger>
            <TabsTrigger value="tune" className="flex-1">
              Tune
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto p-4">
        {errors.length > 0 && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3">
            {errors.map((err, i) => (
              <p key={`err-${i}`} className="text-xs text-destructive">
                {err.path}: {err.message}
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
            />
          ) : (
            <p className="text-sm text-muted-foreground">Loading config...</p>
          )
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tune tab — search space editor will be implemented in a future
              phase. Use Import YAML to set tuning config.
            </p>
          </div>
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
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <FileText className="mr-1 h-3 w-3" />
                Raw Config
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] max-w-2xl overflow-auto">
              <DialogHeader>
                <DialogTitle>Raw Config (read-only)</DialogTitle>
              </DialogHeader>
              <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-4 text-xs">
                {config ? JSON.stringify(config, null, 2) : "No config"}
              </pre>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
