/**
 * Sticky header with Fit/Tune tabs and the primary action button.
 *
 * Extracted from ModelPanel as part of B-3. Pure presentation — data
 * and enable/disable logic come from useModelPanelData.
 */

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface ModelPanelHeaderProps {
  activeTab: "fit" | "tune";
  onActiveTabChange: (tab: "fit" | "tune") => void;
  fitEnabled: boolean;
  tuneEnabled: boolean;
  running: boolean;
  disabledReason: string | null;
  backendLabel: string | null;
  onFit: () => void;
  onTune: () => void;
}

export function ModelPanelHeader({
  activeTab,
  onActiveTabChange,
  fitEnabled,
  tuneEnabled,
  running,
  disabledReason,
  backendLabel,
  onFit,
  onTune,
}: ModelPanelHeaderProps) {
  return (
    <div className="sticky top-0 z-10 border-b bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Model
          </span>
          {backendLabel && (
            <span className="text-[10px] text-muted-foreground">
              {backendLabel}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Tabs
          value={activeTab}
          onValueChange={(v) => onActiveTabChange(v as "fit" | "tune")}
        >
          <TabsList variant="line" className="h-9 w-auto">
            <TabsTrigger value="fit" className="px-6">
              Fit
            </TabsTrigger>
            <TabsTrigger value="tune" className="px-6">
              Tune
            </TabsTrigger>
          </TabsList>
          {/* Issue #90: Radix Tabs auto-generates `aria-controls` on
              each TabsTrigger. Without corresponding <TabsContent>
              elements the attribute points at IDs that do not exist
              in the DOM, which axe's `aria-valid-attr-value` flags.
              The visible Fit/Tune content is rendered outside this
              Tabs tree (see ConfigEditorBody), so the two TabsContent
              nodes below exist only to host the matching aria-controls
              targets. They are visually hidden. */}
          <TabsContent
            value="fit"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
          />
          <TabsContent
            value="tune"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
          />
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
  );
}
