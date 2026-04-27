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

import { useQueryClient } from "@tanstack/react-query";
import equal from "fast-deep-equal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import {
  useBackends,
  useColumns,
  useConfig,
  useConfigSchema,
  useUiSchema,
} from "@/api/queries";
import { queryKeys } from "@/api/queryKeys";
import type { ConfigError } from "@/api/types";
import { updateConfig, uploadConfig, validateConfig } from "@/api/workspace";
import { findEmptyChoiceKeys } from "@/components/workspace/search-space-utils";
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
  const { data: schema } = useConfigSchema();
  const { data: config } = useConfig();
  const { data: backends } = useBackends();
  const backend = backends?.[0];
  const { data: uiSchema } = useUiSchema();
  const { data: columnsData } = useColumns({ enabled: hasData });

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
      // INV-A1/A2/A3 (Issue #276): observe `saved` from PUT /config and
      // do not silently swallow validation rejections. When saved=false
      // the backend kept the prior config, so the cache, history, and
      // errors state must reflect that — not the rejected payload.
      let response: Awaited<ReturnType<typeof updateConfig>>;
      try {
        response = await updateConfig(newConfig);
      } catch {
        toast.error("Failed to update config");
        return;
      }
      if (response?.saved === false) {
        const errs = response.errors ?? [];
        setErrors(errs);
        const summary =
          errs[0]?.message ?? "Config rejected by backend validation";
        toast.error(`Config not saved: ${summary}`);
        // Re-fetch the actual backend state so the UI reflects truth,
        // not the rejected payload the caller tried to apply.
        queryClient.invalidateQueries({ queryKey: queryKeys.config() });
        return;
      }
      queryClient.setQueryData(queryKeys.config(), newConfig);
      history.push(newConfig);
      // Successful save clears any prior rejection errors.
      setErrors([]);

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
      // Issue #276: presets intentionally omit data-bound fields (path,
      // target, time_col, group_col, output_dir). Merging them from the
      // current config ensures the resulting PUT body is valid; without
      // the merge, backend `validate_config` rejects with
      // `data: Field required` and silently keeps the prior config.
      const current = queryClient.getQueryData<Record<string, unknown>>(
        queryKeys.config(),
      );
      const merged: Record<string, unknown> = { ...preset };
      if (current?.data && merged.data === undefined) {
        merged.data = current.data;
      }
      if (current?.output_dir && merged.output_dir === undefined) {
        merged.output_dir = current.output_dir;
      }
      handleConfigChange(merged);
      toast.success(`Preset "${name}" loaded`);
    },
    [loadPreset, handleConfigChange, queryClient],
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
  // Issue #266: any Choice-mode entry with no choices is rejected by the
  // backend. Surface as a client-side block so the user gets a clear
  // signal (banner + disabled Tune) instead of a 422 round-trip.
  const emptyChoiceKeys = useMemo(
    () => findEmptyChoiceKeys(tuningSpace),
    [tuningSpace],
  );
  const tuneEnabled =
    fitEnabled &&
    (allowEmptySpace || Object.keys(tuningSpace).length > 0) &&
    emptyChoiceKeys.length === 0;

  const disabledReason = (() => {
    if (running) return "A job is currently running";
    if (!hasData) return "Load data first";
    if (!config) return "Loading configuration...";
    if (errors.length > 0) return "Fix validation errors first";
    if (activeTab === "tune" && emptyChoiceKeys.length > 0) {
      return `Add at least one choice to: ${emptyChoiceKeys.join(", ")}`;
    }
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
  };
}

export type UseModelPanelData = ReturnType<typeof useModelPanelData>;
