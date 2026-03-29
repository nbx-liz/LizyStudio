import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { fetchUiSchema, runFit, runTune, updateConfig } from "@/api/workspace";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { DataPanel } from "@/components/workspace/DataPanel";
import { ModelPanel } from "@/components/workspace/ModelPanel";
import { ResultsPanel } from "@/components/workspace/ResultsPanel";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export function WorkspacePage() {
  const queryClient = useQueryClient();
  const [hasData, setHasData] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useDocumentTitle(running ? "Running..." : null);

  const { data: uiSchema } = useQuery({
    queryKey: ["ui-schema"],
    queryFn: fetchUiSchema,
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
      toast.error(
        `Fit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setRunning(false);
    }
  }, []);

  const handleTune = useCallback(async () => {
    setRunning(true);
    try {
      const { job_id } = await runTune();
      setCurrentJobId(job_id);
    } catch (err) {
      toast.error(
        `Tune failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setRunning(false);
    }
  }, []);

  const handleApplyToFit = useCallback(
    async (fullConfig: Record<string, unknown>) => {
      try {
        await updateConfig(fullConfig);
        queryClient.invalidateQueries({ queryKey: ["config"] });
        toast.success("Tune config with best params applied");
      } catch {
        toast.error("Failed to apply tune config");
      }
    },
    [queryClient],
  );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full"
      autoSaveId="workspace-panels"
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
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="35%" minSize="20%">
        <ResultsPanel
          jobId={currentJobId}
          onApplyToFit={handleApplyToFit}
          onJobDone={() => setRunning(false)}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
