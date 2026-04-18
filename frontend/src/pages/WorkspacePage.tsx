import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  // Issue #101: hydrate currentJobId from the `?job_id=<id>` query
  // param so the Jobs page (or any external link) can navigate the
  // user directly into the Workspace with a specific completed job
  // selected. The query-param name matches the convention already
  // established by InferencePage so links stay consistent across
  // the two destinations.
  const [searchParams] = useSearchParams();
  // `searchParams.get("job_id")` returns `""` (not `null`) for an
  // explicitly empty `?job_id=` value; normalize with `|| null` so the
  // Results panel sees a clean null and does not try to render an
  // empty-string job id.
  const [currentJobId, setCurrentJobId] = useState<string | null>(
    () => searchParams.get("job_id") || null,
  );
  const [running, setRunning] = useState(false);
  const [modelTab, setModelTab] = useState<"fit" | "tune">("fit");

  // Re-hydrate when the URL param changes (e.g. the user clicks
  // "Open in Workspace" on a SECOND job from the Jobs page, which
  // only updates the search params without remounting this page).
  // The `useState` initializer fires once on mount; without this
  // effect the second navigation would silently keep the first job
  // selected. Mirrors InferencePage's HIGH-4 fix. Suppressed while
  // a fit / tune is actively running so a URL change does not clobber
  // a freshly-started job id set from inside handleFit / handleTune.
  //
  // Note on stale URL: after the user starts a fresh fit / tune via
  // the Workspace UI, we intentionally do NOT rewrite `?job_id=` in
  // the URL bar. If the user reloads the page in the middle of a new
  // run, the URL still points at the previously-hydrated job and
  // they will land back on that historical view. This matches the
  // pre-Issue #101 behavior (reload = back to an empty Workspace)
  // closely enough that we decided not to couple browser history to
  // every in-run job_id change. A future improvement could call
  // `setSearchParams({ job_id: newId })` inside handleFit / handleTune
  // if user feedback asks for it.
  useEffect(() => {
    if (running) return;
    const jobIdParam = searchParams.get("job_id");
    if (jobIdParam) {
      setCurrentJobId(jobIdParam);
    }
  }, [searchParams, running]);

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

  // HIGH-3: stable handler references so ResultsPanel's effect does not
  // tear down and re-subscribe its WebSocket every WorkspacePage render.
  const handleJobDone = useCallback(() => {
    setRunning(false);
    notify("LizyStudio", "Job completed");
  }, [notify]);

  const handleJobStarted = useCallback((childJobId: string) => {
    // H-0062: Re-tune / Resume created a new child job — switch
    // the workspace selection so the user sees its progress.
    setCurrentJobId(childJobId);
    setRunning(true);
  }, []);

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
