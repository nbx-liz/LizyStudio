import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import { useConfig, useUiSchema, useWorkspaceStatus } from "@/api/queries";
import { queryKeys } from "@/api/queryKeys";
import { runFit, runTune } from "@/api/workspace";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DataPanel,
  type DataPanelHandle,
} from "@/components/workspace/DataPanel";
import { ModelPanel } from "@/components/workspace/ModelPanel";
import { ResultsPanel } from "@/components/workspace/ResultsPanel";
import { useBackgroundNotification } from "@/hooks/useBackgroundNotification";
import { useConfigWriteFunnel } from "@/hooks/useConfigWriteFunnel";
import { ConfigWriteFunnelProvider } from "@/hooks/useConfigWriteFunnelContext";
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

  // Issue #363: probe the server on mount so the UI knows whether a
  // previous session left data + config persisted. When ``has_data``
  // is true, we flip the local ``hasData`` flag (via the same
  // ``handleDataChanged`` callback the manual load path uses) and
  // hand the snapshot to ``DataPanel.hydrateFromServer`` so the Path
  // textbox / Target combobox / Column Settings / etc. all repopulate.
  //
  // P-0102 v3-24a: also expose ``current_job_id`` to ``useJobIdParam``
  // as a fallback so a browser reload without ``?job_id=`` re-attaches
  // the Workspace to the previously-running / -completed job.
  const { data: workspaceStatus } = useWorkspaceStatus();

  // Issue #101 + P-0102 v3-24a: hydrate currentJobId from the
  // `?job_id=<id>` query param (deep-link / Jobs-page navigation)
  // and fall back to ``workspaceStatus.current_job_id`` when the URL
  // is empty (browser reload mid-run). The query-param name matches
  // the convention established by InferencePage. `useJobIdParam`
  // (B-8) owns URL→state sync; we pass `suppress: running` so a URL
  // / fallback change does not clobber a freshly-started job id set
  // from handleFit / handleTune.
  //
  // Note on stale URL: after the user starts a fresh fit / tune via
  // the Workspace UI, we intentionally do NOT rewrite `?job_id=` in
  // the URL bar. If the user reloads the page in the middle of a new
  // run, the URL still points at the previously-hydrated job — this
  // matches the pre-Issue #101 behavior and we accept it consciously.
  const { jobId: currentJobId, setJobId: setCurrentJobId } = useJobIdParam({
    suppress: running,
    fallbackJobId: workspaceStatus?.current_job_id ?? null,
  });

  useDocumentTitle(running ? "Running..." : null);
  const notify = useBackgroundNotification();

  const { data: uiSchema } = useUiSchema();
  const { data: config } = useConfig({
    enabled: hasData || workspaceStatus?.has_data === true,
    retry: false,
  });

  // P-0092 Q-1 Phase 2: instantiate the write funnel for the entire
  // Workspace tree. ConfigForm's auto-reset effects route through
  // `enqueueWrite` to keep their PUTs ordered behind whichever cv /
  // target / task change triggered them. Cache writes ride the same
  // funnel so the next render of any consumer reads a consistent
  // snapshot. `getCachedConfig` is a getter (not a value) so the
  // funnel always reads the freshest cache entry at flush time, not
  // a stale closure capture from when the hook was registered.
  //
  // P-0092 Q-1 Phase 4: `updateConfig` returns ConfigUpdateResponse
  // (`{config, errors, saved}`) — we must extract `.config` before
  // writing to the cache. Otherwise the next funnel writer reads back
  // the wrapper and PUTs `{config: {...}, errors: [...], saved: ...}`
  // as the body, which the backend rejects with 500. This was a
  // latent bug from Phase 2 (only useTargetSelection's `replace`
  // ops fired through the funnel pre-Phase-4 and they happened to
  // immediately overwrite the cache via setQueryData on the test
  // path). Phase 4 routes user edits + undo/redo through the funnel,
  // so the wrapper-shaped cache entry now leaks into the next PUT.
  const writeFunnel = useConfigWriteFunnel({
    getCachedConfig: () =>
      queryClient.getQueryData<Record<string, unknown>>(queryKeys.config()),
    onWriteCommitted: (saved) => {
      const wrapper = saved as {
        config?: Record<string, unknown>;
        saved?: boolean;
      };
      // Only update cache when backend confirmed the save. saved=false
      // means the body was rejected; the consumers' invalidateQueries
      // already re-fetches, so a no-op here is correct.
      if (wrapper && wrapper.saved !== false && wrapper.config) {
        queryClient.setQueryData(queryKeys.config(), wrapper.config);
      }
    },
  });

  const handleDataChanged = useCallback(() => {
    setHasData(true);
    queryClient.invalidateQueries({ queryKey: queryKeys.config() });
  }, [queryClient]);

  // Issue #363: rehydrate the Data Panel exactly once after a reload
  // when the server reports a persisted snapshot. Subsequent runs are
  // gated by ``hydratedRef`` so this never re-fires (e.g. on cache
  // refetch or when the user later loads a different CSV manually).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (
      !workspaceStatus?.has_data ||
      !workspaceStatus.data_ref ||
      !config ||
      !dataPanelRef.current
    ) {
      return;
    }
    const cfgData = (config as { data?: Record<string, unknown> }).data;
    const cfgPath = (cfgData?.path as string | undefined) ?? "";
    const cfgTarget = (cfgData?.target as string | undefined) ?? null;
    const cfgTask =
      ((config as { task?: string }).task as
        | "binary"
        | "multiclass"
        | "regression"
        | undefined) ?? null;
    if (!cfgPath) return;
    hydratedRef.current = true;
    const shape = workspaceStatus.data_ref.shape;
    dataPanelRef.current
      .hydrateFromServer({
        path: cfgPath,
        shape: [shape[0] ?? 0, shape[1] ?? 0],
        target: cfgTarget,
        task: cfgTask,
      })
      .catch((err) => {
        // Guard: if hydration fails (e.g. CSV moved on disk), reset
        // the latch so a subsequent successful refetch can retry.
        hydratedRef.current = false;
        console.warn("Workspace rehydration failed:", err);
      });
  }, [workspaceStatus, config]);

  const handleTaskChanged = useCallback((t: string | null) => {
    setTask(t);
  }, []);

  // P-0086 (Issue #251): ref that exposes the DataPanel's merged config
  // at click time so Fit/Tune never reads a stale ws.config that lost
  // the race against an in-flight PUT /config. If the ref isn't
  // attached yet (extremely early in mount) we fall back to the legacy
  // body-less POST, which is backward-compatible with the server.
  const dataPanelRef = useRef<DataPanelHandle | null>(null);

  const submitConfigOrUndefined = useCallback(async () => {
    const handle = dataPanelRef.current;
    if (!handle) return undefined;
    try {
      return await handle.getSubmitConfig();
    } catch (err) {
      // Fall through to body-less POST so the server still receives
      // the run request; better to fit with ws.config than to cancel
      // the user's click on a transient fetch failure. Warn via toast
      // so the user understands why their latest Column Settings edits
      // may not appear in the fitted model (race-fix observability,
      // review feedback on P-0086).
      toast.warning(
        `Using last saved config for this run — live config unavailable (${getErrorMessage(err)})`,
      );
      return undefined;
    }
  }, []);

  const handleFit = useCallback(async () => {
    setRunning(true);
    try {
      const config = await submitConfigOrUndefined();
      const { job_id } = await runFit(config);
      setCurrentJobId(job_id);
    } catch (err) {
      toast.error(`Fit failed: ${getErrorMessage(err)}`);
      setRunning(false);
    }
  }, [setCurrentJobId, submitConfigOrUndefined]);

  const handleTune = useCallback(async () => {
    setRunning(true);
    try {
      const config = await submitConfigOrUndefined();
      const { job_id } = await runTune(config);
      setCurrentJobId(job_id);
    } catch (err) {
      toast.error(`Tune failed: ${getErrorMessage(err)}`);
      setRunning(false);
    }
  }, [setCurrentJobId, submitConfigOrUndefined]);

  // P-0092 Q-1 Phase 6 (cleanup): the last writer to migrate. Apply-to-Fit
  // copies the best Tune params into the Fit config in one atomic write.
  // Routing through the funnel here means it serialises behind any in-flight
  // cv-change / config-form-edit / target-select / auto-reset PUT instead
  // of cross-stomping them. The funnel's onWriteCommitted owns the cache
  // write, so the explicit invalidateQueries that the legacy path needed
  // is no longer required — the saved snapshot is reflected in the cache
  // synchronously after the PUT lands. We still call it on failure so the
  // UI re-syncs to whatever the backend kept.
  const handleApplyToFit = useCallback(
    async (fullConfig: Record<string, unknown>) => {
      const result = await writeFunnel.enqueueWrite({
        kind: "replace",
        config: fullConfig,
        reason: "apply-to-fit",
      });
      if (!result.ok) {
        toast.error("Failed to apply tune config");
        queryClient.invalidateQueries({ queryKey: queryKeys.config() });
        return;
      }
      const wrapper = result.saved as
        | { saved?: boolean; errors?: unknown[] }
        | undefined;
      if (wrapper?.saved === false) {
        toast.error("Failed to apply tune config: backend rejected the body");
        queryClient.invalidateQueries({ queryKey: queryKeys.config() });
        return;
      }
      setModelTab("fit");
      toast.success("Best params applied to Fit tab. Click Fit to run.");
    },
    [queryClient, writeFunnel],
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
      <ConfigWriteFunnelProvider funnel={writeFunnel}>
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
              ref={dataPanelRef}
              onDataChanged={handleDataChanged}
              onTaskChanged={handleTaskChanged}
              uiSchema={uiSchema}
              running={running}
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
      </ConfigWriteFunnelProvider>
    );
  }

  return (
    <ConfigWriteFunnelProvider funnel={writeFunnel}>
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
              ref={dataPanelRef}
              onDataChanged={handleDataChanged}
              onTaskChanged={handleTaskChanged}
              uiSchema={uiSchema}
              running={running}
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
    </ConfigWriteFunnelProvider>
  );
}
