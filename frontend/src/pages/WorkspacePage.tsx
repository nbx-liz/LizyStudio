import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, SlidersHorizontal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import { useConfig, useUiSchema } from "@/api/queries";
import { queryKeys } from "@/api/queryKeys";
import { runFit, runTune, updateConfig } from "@/api/workspace";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataPanel } from "@/components/workspace/DataPanel";
import { ModelPanel } from "@/components/workspace/ModelPanel";
import { ResultsPanel } from "@/components/workspace/ResultsPanel";
import { useBackgroundNotification } from "@/hooks/useBackgroundNotification";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useJobIdParam } from "@/hooks/useJobIdParam";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useMediaQuery } from "@/hooks/useMediaQuery";

// Issue #178: swap the Workspace to a bottom-tab layout when the
// viewport is narrower than Tailwind's `md` breakpoint. The three
// ResizablePanels collapse to unusable widths at 375 px; a one-panel-
// at-a-time tab view is the only layout that remains usable on a
// phone-sized viewport without redesigning each panel individually.
const MOBILE_QUERY = "(max-width: 767px)";

type MobileTab = "data" | "model" | "results";

export function WorkspacePage() {
  const queryClient = useQueryClient();
  const [hasData, setHasData] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [modelTab, setModelTab] = useState<"fit" | "tune">("fit");
  const [mobileTab, setMobileTab] = useState<MobileTab>("data");

  const isMobile = useMediaQuery(MOBILE_QUERY);

  // Issue #101: hydrate currentJobId from the `?job_id=<id>` query
  // param so the Jobs page (or any external link) can navigate the
  // user directly into the Workspace with a specific completed job
  // selected. The query-param name matches the convention already
  // established by InferencePage so links stay consistent across
  // the two destinations. `useJobIdParam` (B-8) owns URL→state sync;
  // we pass `suppress: running` so a URL change does not clobber a
  // freshly-started job id set from handleFit / handleTune.
  //
  // Note on stale URL: after the user starts a fresh fit / tune via
  // the Workspace UI, we intentionally do NOT rewrite `?job_id=` in
  // the URL bar. If the user reloads the page in the middle of a new
  // run, the URL still points at the previously-hydrated job — this
  // matches the pre-Issue #101 behavior and we accept it consciously.
  const { jobId: currentJobId, setJobId: setCurrentJobId } = useJobIdParam({
    suppress: running,
  });

  useDocumentTitle(running ? "Running..." : null);
  const notify = useBackgroundNotification();

  const { data: uiSchema } = useUiSchema();
  const { data: config } = useConfig({ enabled: hasData, retry: false });

  const handleDataChanged = useCallback(() => {
    setHasData(true);
    queryClient.invalidateQueries({ queryKey: queryKeys.config() });
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
  }, [setCurrentJobId]);

  const handleTune = useCallback(async () => {
    setRunning(true);
    try {
      const { job_id } = await runTune();
      setCurrentJobId(job_id);
    } catch (err) {
      toast.error(`Tune failed: ${getErrorMessage(err)}`);
      setRunning(false);
    }
  }, [setCurrentJobId]);

  const handleApplyToFit = useCallback(
    async (fullConfig: Record<string, unknown>) => {
      try {
        await updateConfig(fullConfig);
        queryClient.invalidateQueries({ queryKey: queryKeys.config() });
        setModelTab("fit");
        toast.success("Best params applied to Fit tab. Click Fit to run.");
      } catch {
        toast.error("Failed to apply tune config");
      }
    },
    [queryClient],
  );

  // HIGH-3: stable handler references so ResultsPanel's effect does not
  // tear down and re-subscribe its WebSocket every WorkspacePage render.
  const handleJobDone = useCallback(() => {
    setRunning(false);
    notify("LizyStudio", "Job completed");
  }, [notify]);

  const handleJobStarted = useCallback(
    (childJobId: string) => {
      // H-0062: Re-tune / Resume created a new child job — switch
      // the workspace selection so the user sees its progress.
      setCurrentJobId(childJobId);
      setRunning(true);
      // Issue #178: on mobile, the Results panel is on a separate tab —
      // move focus to it when a child job starts so the user sees the
      // progress view immediately instead of staying on Data/Model.
      setMobileTab("results");
    },
    [setCurrentJobId],
  );

  const shortcuts = useMemo(
    () => [
      { key: "Enter", ctrl: true, action: () => handleFit() },
      { key: "Enter", ctrl: true, shift: true, action: () => handleTune() },
    ],
    [handleFit, handleTune],
  );
  useKeyboardShortcuts(shortcuts);

  if (isMobile) {
    return (
      <Tabs
        value={mobileTab}
        onValueChange={(v) => setMobileTab(v as MobileTab)}
        className="flex h-full flex-col gap-0"
      >
        <TabsContent
          value="data"
          className="flex-1 overflow-auto focus-visible:outline-none"
        >
          <DataPanel
            onDataChanged={handleDataChanged}
            onTaskChanged={handleTaskChanged}
            uiSchema={uiSchema}
          />
        </TabsContent>
        <TabsContent
          value="model"
          className="flex-1 overflow-auto focus-visible:outline-none"
        >
          <ModelPanel
            hasData={hasData}
            task={task}
            onFit={handleFit}
            onTune={handleTune}
            running={running}
            activeTab={modelTab}
            onActiveTabChange={setModelTab}
          />
        </TabsContent>
        <TabsContent
          value="results"
          className="flex-1 overflow-auto focus-visible:outline-none"
        >
          <ResultsPanel
            jobId={currentJobId}
            hasData={hasData}
            hasConfig={hasData && config != null}
            currentConfig={config ?? undefined}
            onApplyToFit={handleApplyToFit}
            onJobDone={handleJobDone}
            onJobStarted={handleJobStarted}
          />
        </TabsContent>
        <TabsList
          aria-label="Workspace sections"
          className="h-14 w-full shrink-0 justify-around rounded-none border-t border-border bg-background p-0"
        >
          <TabsTrigger
            value="data"
            className="flex h-full flex-1 flex-col gap-0.5 rounded-none text-xs"
          >
            <Database className="size-4" />
            Data
          </TabsTrigger>
          <TabsTrigger
            value="model"
            className="flex h-full flex-1 flex-col gap-0.5 rounded-none text-xs"
          >
            <SlidersHorizontal className="size-4" />
            Model
          </TabsTrigger>
          <TabsTrigger
            value="results"
            className="relative flex h-full flex-1 flex-col gap-0.5 rounded-none text-xs"
          >
            <BarChart3 className="size-4" />
            Results
            {running && mobileTab !== "results" && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-3 size-2 animate-pulse rounded-full bg-primary"
              />
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    );
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full"
      id="workspace-panels"
    >
      {/*
       * Issue #167: on narrow viewports the inline-styled scroll
       * wrappers inside react-resizable-panels lack keyboard access
       * (axe `scrollable-region-focusable`). The panel children are
       * wrapped in <section tabIndex={0}> so each resizable region is
       * reachable via Tab and scrollable via arrow keys. The inner
       * components already render their own h-full wrappers; the
       * section keeps h-full + flex so layout is unchanged.
       */}
      <ResizablePanel defaultSize="30%" minSize="20%" maxSize="45%">
        <section
          aria-label="Data region"
          tabIndex={0}
          className="flex h-full flex-col focus-visible:outline-none"
        >
          <DataPanel
            onDataChanged={handleDataChanged}
            onTaskChanged={handleTaskChanged}
            uiSchema={uiSchema}
          />
        </section>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="35%" minSize="20%">
        <section
          aria-label="Model region"
          tabIndex={0}
          className="flex h-full flex-col focus-visible:outline-none"
        >
          <ModelPanel
            hasData={hasData}
            task={task}
            onFit={handleFit}
            onTune={handleTune}
            running={running}
            activeTab={modelTab}
            onActiveTabChange={setModelTab}
          />
        </section>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="35%" minSize="20%">
        <section
          aria-label="Results region"
          tabIndex={0}
          className="flex h-full flex-col focus-visible:outline-none"
        >
          <ResultsPanel
            jobId={currentJobId}
            hasData={hasData}
            hasConfig={hasData && config != null}
            currentConfig={config ?? undefined}
            onApplyToFit={handleApplyToFit}
            onJobDone={handleJobDone}
            onJobStarted={handleJobStarted}
          />
        </section>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
