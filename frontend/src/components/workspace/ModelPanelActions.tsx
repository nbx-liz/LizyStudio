/**
 * Sticky-footer config action bar — Import / Export / Undo / Redo /
 * Preset save-load / Raw-config viewer.
 *
 * Extracted from ModelPanel as part of B-3. Pure presentation; the
 * handlers come from useModelPanelData via props.
 */

import {
  ChevronDown,
  Download,
  FileText,
  FileUp,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import { useRef, useState } from "react";
import { getConfigDownloadUrl } from "@/api/workspace";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ConfigPreset } from "@/hooks/useConfigPresets";
import { RawConfigDialog } from "./RawConfigDialog";

export interface ModelPanelActionsProps {
  running: boolean;
  config: Record<string, unknown> | undefined;
  canUndo: boolean;
  canRedo: boolean;
  presets: ConfigPreset[];
  onImport: (file: File) => Promise<void> | void;
  onUndo: () => Promise<void> | void;
  onRedo: () => Promise<void> | void;
  onOpenSavePreset: () => void;
  onLoadPreset: (name: string) => void;
}

export function ModelPanelActions({
  running,
  config,
  canUndo,
  canRedo,
  presets,
  onImport,
  onUndo,
  onRedo,
  onOpenSavePreset,
  onLoadPreset,
}: ModelPanelActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onImport(file);
    e.target.value = "";
  };

  const handleExport = () => {
    window.open(getConfigDownloadUrl(), "_blank");
  };

  return (
    <div
      className={`shrink-0 border-t bg-background px-4 py-3${
        running ? " pointer-events-none opacity-60" : ""
      }`}
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
          onChange={handleFileChange}
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
              onClick={onUndo}
              disabled={!canUndo}
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
              onClick={onRedo}
              disabled={!canRedo}
              aria-label="Redo"
            >
              <Redo2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo</TooltipContent>
        </Tooltip>

        <div className="h-4 w-px bg-border" />

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSavePreset}
          disabled={!config}
        >
          <Save className="mr-1 h-3 w-3" />
          Save Preset
        </Button>
        {presets.length > 0 && (
          <LoadPresetMenu presets={presets} onLoadPreset={onLoadPreset} />
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
  );
}

/**
 * Load Preset menu. Issue #369.
 *
 * The pre-fix component used a Radix ``Select``, which does not fire
 * ``onValueChange`` when the user picks the same option that is
 * already "selected" — making it impossible to re-apply a preset
 * after the config drifted. Replace the action-shaped flow with a
 * Popover-driven menu where each preset is a button that always
 * fires ``onLoadPreset`` on click.
 */
function LoadPresetMenu({
  presets,
  onLoadPreset,
}: {
  presets: ConfigPreset[];
  onLoadPreset: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Load preset"
          aria-haspopup="menu"
          className="h-8 w-36 justify-between text-xs"
        >
          <span>Load Preset</span>
          <ChevronDown className="ml-1 h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start" role="menu">
        {presets.map((p) => (
          <button
            key={p.name}
            type="button"
            role="menuitem"
            className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              onLoadPreset(p.name);
              setOpen(false);
            }}
          >
            {p.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
