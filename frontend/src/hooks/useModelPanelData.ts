/**
 * Data + handlers for ModelPanel.
 *
 * ModelPanel is the workspace panel that hosts the Fit/Tune config
 * editor. Before B-3 it was a 484-line God component that owned 5
 * useQuery calls, debounced validation, undo/redo, import/export, and
 * preset save/load all inline. This hook lifts the data + side effects
 * out so the component can be split into a header / body / actions
 * trio without prop drilling.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import equal from "fast-deep-equal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import { queryKeys } from "@/api/queryKeys";
import type { ConfigError } from "@/api/types";
import {
  fetchBackends,
  fetchColumns,
  fetchConfig,
  fetchConfigSchema,
  fetchUiSchema,
  updateConfig,
  uploadConfig,
  validateConfig,
} from "@/api/workspace";
import { useConfigHistory } from "@/hooks/useConfigHistory";
import { useConfigPresets } from "@/hooks/useConfigPresets";

const VALIDATION_DEBOUNCE_MS = 500;

export interface UseModelPanelDataParams {
  hasData: boolean;
  running?: boolean;
  activeTab?: "fit" | "tune";
}

export function useModelPanelData({
  hasData,
  running = false,
  activeTab = "fit",
}: UseModelPanelDataParams) {
  const queryClient = useQueryClient();
  const history = useConfigHistory();
  const { presets, save: savePreset, load: loadPreset } = useConfigPresets();
  const [errors, setErrors] = useState<ConfigError[]>([]);

  // --------------------------------------------------------------------
  // Data
  // --------------------------------------------------------------------
  const { data: schema } = useQuery({
    queryKey: queryKeys.configSchema(),
    queryFn: fetchConfigSchema,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { data: config } = useQuery({
    queryKey: queryKeys.config(),
    queryFn: fetchConfig,
  });

  const { data: backends } = useQuery({
    queryKey: queryKeys.backends(),
    queryFn: fetchBackends,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const backend = backends?.[0];

  const { data: uiSchema } = useQuery({
    queryKey: queryKeys.uiSchema(),
    queryFn: fetchUiSchema,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { data: columnsData } = useQuery({
    queryKey: queryKeys.columns(),
    queryFn: () => fetchColumns(),
    enabled: hasData,
  });

  const nonExcludedColumns = useMemo(() => {
    if (!columnsData?.columns) return [];
    return columnsData.columns
      .filter((c) => !c.suggested_excluded)
      .map((c) => c.name);
  }, [columnsData]);

  // --------------------------------------------------------------------
  // Debounced validation on change
  // --------------------------------------------------------------------
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    return () => clearTimeout(validateTimer.current);
  }, []);

  const handleConfigChange = useCallback(
    async (newConfig: Record<string, unknown>) => {
      if (running) return;
      const cached = queryClient.getQueryData<Record<string, unknown>>(
        queryKeys.config(),
      );
      if (cached && equal(cached, newConfig)) {
        return;
      }
      try {
        await updateConfig(newConfig);
        queryClient.setQueryData(queryKeys.config(), newConfig);
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
          // silent — validation failures are surfaced via the errors
          // state on the next successful call
        }
      }, VALIDATION_DEBOUNCE_MS);
    },
    [queryClient, running, history.push],
  );

  // --------------------------------------------------------------------
  // Import / undo / redo
  // --------------------------------------------------------------------
  const handleImport = useCallback(
    async (file: File) => {
      try {
        const result = await uploadConfig(file);
        setErrors(result.errors);
        queryClient.invalidateQueries({ queryKey: queryKeys.config() });
        toast.success("Config imported");
      } catch (err) {
        toast.error(`Import failed: ${getErrorMessage(err)}`);
      }
    },
    [queryClient],
  );

  const handleUndo = useCallback(async () => {
    const prev = history.undo();
    if (!prev) return;
    try {
      await updateConfig(prev);
      queryClient.setQueryData(queryKeys.config(), prev);
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
      queryClient.setQueryData(queryKeys.config(), next);
      toast.info("Config redone");
    } catch {
      toast.error("Redo failed");
    }
  }, [history, queryClient]);

  // --------------------------------------------------------------------
  // Preset handlers
  // --------------------------------------------------------------------
  const confirmSavePreset = useCallback(
    (name: string) => {
      if (!config) return;
      savePreset(name, config);
      toast.success(`Preset "${name}" saved`);
    },
    [config, savePreset],
  );

  const handleLoadPreset = useCallback(
    (name: string) => {
      const preset = loadPreset(name);
      if (!preset) return;
      handleConfigChange(preset);
      toast.success(`Preset "${name}" loaded`);
    },
    [loadPreset, handleConfigChange],
  );

  // --------------------------------------------------------------------
  // Derived enable/disable state
  // --------------------------------------------------------------------
  const fitEnabled = hasData && !!config && !running && errors.length === 0;
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

  return {
    schema,
    config,
    backend,
    uiSchema,
    nonExcludedColumns,
    errors,
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
  };
}

export type UseModelPanelData = ReturnType<typeof useModelPanelData>;
