import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import {
  fetchConfig,
  fetchUiSchema,
  runFit,
  runTune,
  updateConfig,
} from "@/api/workspace";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { DataPanel } from "@/components/workspace/DataPanel";
import { ModelPanel } from "@/components/workspace/ModelPanel";
import { ResultsPanel } from "@/components/workspace/ResultsPanel";
import { useBackgroundNotification } from "@/hooks/useBackgroundNotification";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export function WorkspacePage() {
  const queryClient = useQueryClient();
  const [hasData, setHasData] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [modelTab, setModelTab] = useState<"fit" | "tune">("fit");

  useDocumentTitle(running ? "Running..." : null);
  const notify = useBackgroundNotification();

  const { data: uiSchema } = useQuery({
    queryKey: ["ui-schema"],
    queryFn: fetchUiSchema,
  });

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
    enabled: hasData,
    retry: false,
  });

  const handleDataChanged = useCallback(() => {
    setHasData(true);
    queryClient.invalidateQueries({ queryKey: ["config"] });
  }, [queryClient]);

  const handleTaskChanged = useCallback((t: string | null) => {
    setTask(t);
  }, []);

  const handleFit = useCallback(async () => {
    setRunning(true);
    try {
      const { job_id } = await runFit();
      setCurrentJobId(job_id);
    } catch (err) {
      toast.error(`Fit failed: ${getErrorMessage(err)}`);
      setRunning(false);
    }
  }, []);

  const handleTune = useCallback(async () => {
    setRunning(true);
    try {
      const { job_id } = await runTune();
      setCurrentJobId(job_id);
    } catch (err) {
      toast.error(`Tune failed: ${getErrorMessage(err)}`);
      setRunning(false);
    }
  }, []);

  const handleApplyToFit = useCallback(
    async (fullConfig: Record<string, unknown>) => {
      try {
        await updateConfig(fullConfig);
        queryClient.invalidateQueries({ queryKey: ["config"] });
        setModelTab("fit");
        toast.success("Best params applied to Fit tab. Click Fit to run.");
      } catch {
        toast.error("Failed to apply tune config");
      }
    },
    [queryClient],
  );

  const shortcuts = useMemo(
    () => [
      { key: "Enter", ctrl: true, action: () => handleFit() },
      { key: "Enter", ctrl: true, shift: true, action: () => handleTune() },
    ],
    [handleFit, handleTune],
  );
  useKeyboardShortcuts(shortcuts);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full"
      id="workspace-panels"
    >
      <ResizablePanel defaultSize="30%" minSize="20%" maxSize="45%">
        <DataPanel
          onDataChanged={handleDataChanged}
          onTaskChanged={handleTaskChanged}
          uiSchema={uiSchema}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="35%" minSize="20%">
        <ModelPanel
          hasData={hasData}
          task={task}
          onFit={handleFit}
          onTune={handleTune}
          running={running}
          activeTab={modelTab}
          onActiveTabChange={setModelTab}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="35%" minSize="20%">
        <ResultsPanel
          jobId={currentJobId}
          hasData={hasData}
          hasConfig={hasData && config != null}
          onApplyToFit={handleApplyToFit}
          onJobDone={() => {
            setRunning(false);
            notify("LizyStudio", "Job completed");
          }}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
