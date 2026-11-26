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
import {
  getErrorMessage,
  getValidationErrors,
  isWorkspaceLocked,
  summarizeValidationErrors,
} from "@/api/errors";
import {
  useBackends,
  useColumns,
  useConfig,
  useConfigSchema,
  useUiSchema,
} from "@/api/queries";
import { queryKeys } from "@/api/queryKeys";
import { type ConfigError, isBlockingError } from "@/api/types";
import { updateConfig, uploadConfig, validateConfig } from "@/api/workspace";
import { findEmptyChoiceKeys } from "@/components/workspace/search-space-utils";
import { useConfigHistory } from "@/hooks/useConfigHistory";
import { useConfigPresets } from "@/hooks/useConfigPresets";
import type {
  ConfigWriteFunnel,
  WriteReason,
} from "@/hooks/useConfigWriteFunnel";
import { useConfigWriteFunnelOptional } from "@/hooks/useConfigWriteFunnelContext";
import { useConfigWritePending } from "@/hooks/useConfigWritePending";

const VALIDATION_DEBOUNCE_MS = 500;

export interface UseModelPanelDataParams {
  hasData: boolean;
  running?: boolean;
  activeTab?: "fit" | "tune";
  /**
   * P-0092 Q-1 Phase 4: write funnel injected by tests when they need
   * to drive the hook outside a `ConfigWriteFunnelProvider`. Production
   * code reads the funnel from context — leave this `undefined` and let
   * `useConfigWriteFunnelOptional()` resolve it.
   */
  writeFunnel?: ConfigWriteFunnel | null;
}

export function useModelPanelData({
  hasData,
  running = false,
  activeTab = "fit",
  writeFunnel: writeFunnelOverride,
}: UseModelPanelDataParams) {
  const queryClient = useQueryClient();
  const history = useConfigHistory();
  const { presets, save: savePreset, load: loadPreset } = useConfigPresets();
  const [errors, setErrors] = useState<ConfigError[]>([]);

  // P-0092 Q-1 Phase 4: pull the optional write funnel from the
  // Workspace-level provider so handleConfigChange / handleUndo /
  // handleRedo serialise behind in-flight target-select / cv-change
  // writers. The hook still owns the 422 / 409 / debounce
  // observation logic — the funnel only owns the network call ordering.
  // Tests inject `writeFunnel` directly via params; production reads
  // from context.
  const contextFunnel = useConfigWriteFunnelOptional();
  const writeFunnel =
    writeFunnelOverride !== undefined ? writeFunnelOverride : contextFunnel;
  // P-0110: true while a config write is queued or in flight; undo / redo
  // and preset load are disabled then (owner ruling, PR #781 round 2).
  const writePending = useConfigWritePending(writeFunnel);

  // --------------------------------------------------------------------
  // Data
  // --------------------------------------------------------------------
  const { data: schema } = useConfigSchema();
  const { data: config } = useConfig();
  const { data: backends } = useBackends();
  const backend = backends?.[0];
  const { data: uiSchema } = useUiSchema();
  const { data: columnsData } = useColumns({ enabled: hasData });

  // P-0091 / Issue #277: nonExcludedColumns is the source list for
  // FeatureWeightsEditor's "Add feature" picker (and any other model-side
  // consumer that needs the user-selectable feature names). It must
  // exclude:
  //   1. The target column — weighting the prediction target is
  //      semantically nonsensical and gets dropped server-side.
  //   2. User-excluded features (config.features.exclude) — the backend
  //      will not see those columns at fit time, so allowing the user
  //      to weight them is a confusing dead-end.
  //   3. Auto-suggested excluded columns (id-like / constant) — same
  //      class of dead-end as #2.
  // The cached config is the source of truth for #1 and #2; columnsData
  // covers #3 via ``suggested_excluded``.
  const nonExcludedColumns = useMemo(() => {
    if (!columnsData?.columns) return [];
    const target = (config?.data as { target?: string } | undefined)?.target;
    const excludedRaw = (config?.features as { exclude?: unknown } | undefined)
      ?.exclude;
    const userExcluded = new Set<string>(
      Array.isArray(excludedRaw)
        ? excludedRaw.filter((v): v is string => typeof v === "string")
        : [],
    );
    return columnsData.columns
      .filter((c) => !c.suggested_excluded)
      .filter((c) => c.name !== target)
      .filter((c) => !userExcluded.has(c.name))
      .map((c) => c.name);
  }, [columnsData, config]);

  // --------------------------------------------------------------------
  // Debounced validation on change
  // --------------------------------------------------------------------
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    return () => clearTimeout(validateTimer.current);
  }, []);

  // Resolves `true` when the backend holds `newConfig` afterwards (saved
  // now, or already equal to the cached server config) and `false` when it
  // does not (refused, failed, or skipped while a job runs), so callers
  // such as `handleLoadPreset` can gate their own success feedback.
  const handleConfigChange = useCallback(
    async (newConfig: Record<string, unknown>): Promise<boolean> => {
      if (running) return false;
      const cached = queryClient.getQueryData<Record<string, unknown>>(
        queryKeys.config(),
      );
      if (cached && equal(cached, newConfig)) {
        return true;
      }
      // INV-A1/A2/A3 (Issue #276) + P-0110: a blocking validation
      // rejection is a 422 Problem Details error, never a 200. The
      // backend kept the prior config, so the cache, history, and errors
      // state must reflect that — not the rejected payload.
      //
      // P-0092 Q-1 Phase 4: route through the write funnel when one is
      // mounted so this user-edit PUT serialises behind any in-flight
      // target-select / cv-change writer. The funnel's WriteResult
      // carries the original error in `details` on failure, so the
      // 422 / 409 observation logic stays right here.
      const rejectWrite = (err: unknown): void => {
        // P-0089 / Issue #279: 409 WORKSPACE_LOCKED means a fit/tune
        // job is running and the config is intentionally immutable.
        // Surface a quiet info toast (the section-level disabled
        // controls already explain the lock) and re-fetch so the form
        // resyncs to the locked-in config.
        if (isWorkspaceLocked(err)) {
          toast.info("Config is locked while a job is running");
          queryClient.invalidateQueries({ queryKey: queryKeys.config() });
          return;
        }
        const validationErrors = getValidationErrors(err);
        if (validationErrors !== null) {
          setErrors(validationErrors);
          toast.error(
            `Config not saved: ${summarizeValidationErrors(validationErrors)}`,
          );
          // Re-fetch the actual backend state so the UI reflects truth,
          // not the rejected payload the caller tried to apply.
          queryClient.invalidateQueries({ queryKey: queryKeys.config() });
          return;
        }
        toast.error("Failed to update config");
      };
      try {
        if (writeFunnel) {
          const result = await writeFunnel.enqueueWrite({
            kind: "replace",
            config: newConfig,
            reason: "config-form-edit",
          });
          if (!result.ok) {
            // An aborted write means the funnel tore down: not a refusal.
            if (result.error !== "aborted") rejectWrite(result.details);
            return false;
          }
        } else {
          await updateConfig(newConfig);
        }
      } catch (err) {
        rejectWrite(err);
        return false;
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
      return true;
    },
    [queryClient, running, history.push, writeFunnel],
  );

  // --------------------------------------------------------------------
  // Import / undo / redo
  // --------------------------------------------------------------------
  const handleImport = useCallback(
    async (file: File) => {
      try {
        const result = await uploadConfig(file);
        setErrors(result.validation_errors);
        queryClient.invalidateQueries({ queryKey: queryKeys.config() });
        toast.success("Config imported");
      } catch (err) {
        // P-0110: a config that fails validation is a 422, not a 200
        // with saved=false — show why, and keep the prior config.
        const validationErrors = getValidationErrors(err);
        if (validationErrors !== null) {
          setErrors(validationErrors);
          toast.error(
            `Import failed: ${summarizeValidationErrors(validationErrors)}`,
          );
          return;
        }
        toast.error(`Import failed: ${getErrorMessage(err)}`);
      }
    },
    [queryClient],
  );

  // P-0092 Q-1 Phase 4: undo/redo route through the funnel when one is
  // mounted, mirroring handleConfigChange. Failures fall back to the
  // legacy toast — the funnel's WriteResult.ok=false collapses both
  // network errors and 409 lock into the same "Undo failed" path
  // because undo is unlikely to race with a running job (the controls
  // are disabled while running) and a redo of a legitimate prior state
  // either re-saves or no-ops.
  //
  // H-3: the funnel path returns `viaFunnel=true` so the caller can
  // skip its explicit `setQueryData` — the funnel's `onWriteCommitted`
  // already wrote the backend's *canonical* (post-normalisation)
  // snapshot to the cache. Following up with the local history entry
  // would silently undo whatever the backend normalised (e.g. inserted
  // random_state defaults). The legacy path still needs the explicit
  // setQueryData because no `onWriteCommitted` is wired there.
  const sendThroughFunnelOrLegacy = useCallback(
    async (
      body: Record<string, unknown>,
      reason: WriteReason,
    ): Promise<{ ok: boolean; viaFunnel: boolean; error?: unknown }> => {
      if (writeFunnel) {
        const result = await writeFunnel.enqueueWrite({
          kind: "replace",
          config: body,
          reason,
        });
        return result.ok
          ? { ok: true, viaFunnel: true }
          : { ok: false, viaFunnel: true, error: result.details };
      }
      try {
        await updateConfig(body);
        return { ok: true, viaFunnel: false };
      } catch (err) {
        return { ok: false, viaFunnel: false, error: err };
      }
    },
    [writeFunnel],
  );

  // P-0110 (BLUEPRINT §6.3): a refused undo / redo shows why. A lock is
  // the quiet info toast; a 422 fills the errors state and names the
  // first blocking entry; anything else keeps the generic message.
  const reportHistoryFailure = useCallback(
    (label: "Undo" | "Redo", err: unknown) => {
      if (isWorkspaceLocked(err)) {
        toast.info("Config is locked while a job is running");
        return;
      }
      const validationErrors = getValidationErrors(err);
      if (validationErrors !== null) {
        setErrors(validationErrors);
        toast.error(
          `${label} failed: ${summarizeValidationErrors(validationErrors)}`,
        );
        return;
      }
      toast.error(`${label} failed`);
    },
    [],
  );

  // P-0110: the cursor moves only after the backend accepted the PUT, so
  // a refused undo / redo (422 / 409) leaves the history where it was.
  // Owner ruling (PR #781 round 2): undo / redo are disabled while a
  // config write is pending (`writePending`), and the handlers return
  // early if called then, so no other write can interleave between the
  // snapshot read and this commit.
  const handleUndo = useCallback(async () => {
    if (writeFunnel?.isFlushing()) return;
    const prev = history.peekUndo();
    if (!prev) return;
    const { ok, viaFunnel, error } = await sendThroughFunnelOrLegacy(
      prev,
      "undo",
    );
    if (!ok) {
      reportHistoryFailure("Undo", error);
      return;
    }
    history.undo();
    if (!viaFunnel) {
      queryClient.setQueryData(queryKeys.config(), prev);
    }
    toast.info("Config undone");
  }, [
    history,
    queryClient,
    sendThroughFunnelOrLegacy,
    reportHistoryFailure,
    writeFunnel,
  ]);

  const handleRedo = useCallback(async () => {
    if (writeFunnel?.isFlushing()) return;
    const next = history.peekRedo();
    if (!next) return;
    const { ok, viaFunnel, error } = await sendThroughFunnelOrLegacy(
      next,
      "redo",
    );
    if (!ok) {
      reportHistoryFailure("Redo", error);
      return;
    }
    history.redo();
    if (!viaFunnel) {
      queryClient.setQueryData(queryKeys.config(), next);
    }
    toast.info("Config redone");
  }, [
    history,
    queryClient,
    sendThroughFunnelOrLegacy,
    reportHistoryFailure,
    writeFunnel,
  ]);

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
    async (name: string) => {
      // Owner ruling (PR #781 round 2): no preset load while a config
      // write is pending, so its single write cannot coalesce with or
      // queue behind another one; the menu is disabled then too.
      if (writeFunnel?.isFlushing()) return;
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
      // P-0110: claim success only once the backend saved the preset. A
      // refused write already shows its own toast in handleConfigChange.
      const saved = await handleConfigChange(merged);
      if (saved) toast.success(`Preset "${name}" loaded`);
    },
    [loadPreset, handleConfigChange, queryClient, writeFunnel],
  );

  // --------------------------------------------------------------------
  // Derived enable/disable state
  // --------------------------------------------------------------------
  // Issue #394 / PR-C2: only severity="error" entries block Fit/Tune.
  // Warnings (e.g. metric-vs-target compatibility) advise but do not
  // gate the run. Pre-PR-B4 backends do not emit severity, so missing
  // values default to "error" via ``isBlockingError``.
  const blockingErrors = errors.filter(isBlockingError);
  const fitEnabled =
    hasData && !!config && !running && blockingErrors.length === 0;
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
    if (blockingErrors.length > 0) return "Fix validation errors first";
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
    writePending,
  };
}

export type UseModelPanelData = ReturnType<typeof useModelPanelData>;
