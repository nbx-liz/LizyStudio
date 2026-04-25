import { useState } from "react";
import { useModelPanelData } from "@/hooks/useModelPanelData";
import { ConfigEditorBody } from "./ConfigEditorBody";
import { ModelPanelActions } from "./ModelPanelActions";
import { ModelPanelHeader } from "./ModelPanelHeader";
import { SavePresetDialog } from "./SavePresetDialog";

interface ModelPanelProps {
  hasData: boolean;
  task: string | null;
  onFit: () => void;
  onTune: () => void;
  running: boolean;
  activeTab?: "fit" | "tune";
  onActiveTabChange?: (tab: "fit" | "tune") => void;
}

export function ModelPanel({
  hasData,
  task,
  onFit,
  onTune,
  running,
  activeTab: controlledTab,
  onActiveTabChange,
}: ModelPanelProps) {
  const [internalTab, setInternalTab] = useState<"fit" | "tune">("fit");
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: "fit" | "tune") => {
    setInternalTab(tab);
    onActiveTabChange?.(tab);
  };
  const [savePresetOpen, setSavePresetOpen] = useState(false);

  const data = useModelPanelData({ hasData, running, activeTab });
  const {
    schema,
    config,
    backend,
    uiSchema,
    nonExcludedColumns,
    errors,
    emptyChoiceKeys,
    presets,
    history,
    fitEnabled,
    tuneEnabled,
    disabledReason,
    handleConfigChange,
    handleImport,
    handleUndo,
    handleRedo,
    confirmSavePreset,
    handleLoadPreset,
  } = data;

  const backendLabel = backend ? `${backend.name} v${backend.version}` : null;

  return (
    <div className="flex h-full flex-col">
      <ModelPanelHeader
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        fitEnabled={fitEnabled}
        tuneEnabled={tuneEnabled}
        running={running}
        disabledReason={disabledReason}
        backendLabel={backendLabel}
        onFit={onFit}
        onTune={onTune}
      />

      <ConfigEditorBody
        activeTab={activeTab}
        hasData={hasData}
        running={running}
        errors={errors}
        emptyChoiceKeys={emptyChoiceKeys}
        schema={schema}
        config={config}
        onChange={handleConfigChange}
        task={task}
        uiSchema={uiSchema}
        columns={nonExcludedColumns}
      />

      <ModelPanelActions
        running={running}
        config={config}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        presets={presets}
        onImport={handleImport}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenSavePreset={() => setSavePresetOpen(true)}
        onLoadPreset={handleLoadPreset}
      />

      <SavePresetDialog
        open={savePresetOpen}
        onOpenChange={setSavePresetOpen}
        onSave={confirmSavePreset}
        existingNames={presets.map((p) => p.name)}
      />
    </div>
  );
}
