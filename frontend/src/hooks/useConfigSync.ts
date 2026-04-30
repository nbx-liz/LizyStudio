import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { isStudioError } from "@/api/errors";
import { queryKeys } from "@/api/queryKeys";
import type { UiSchema } from "@/api/types";
import {
  fetchConfig,
  fetchConfigDefaults,
  updateConfig,
} from "@/api/workspace";
import type { BlockedGroupKFoldState } from "@/components/workspace/BlockedGroupKFoldEditor";
import {
  type CvState,
  pruneInnerValidForMethod,
  recommendedInnerValid,
} from "@/components/workspace/cv-state";
import { buildSyncedConfig } from "./buildSyncedConfig";
import type { ConfigWriteFunnel } from "./useConfigWriteFunnel";
import { useConfigWriteFunnelOptional } from "./useConfigWriteFunnelContext";
import type { ColumnOverride, TaskType } from "./useDataPanel.types";
import { buildSyncKey } from "./useDataPanel.types";

interface UseConfigSyncParams {
  dataPath: string;
  target: string | null;
  task: TaskType | null;
  overrides: Record<string, ColumnOverride>;
  cv: CvState;
  blocked: BlockedGroupKFoldState;
  uiSchema?: UiSchema;
  onDataChanged: () => void;
  /**
   * P-0092 Q-1 Phase 5: write funnel injected by tests when they need
   * to drive the hook outside a `ConfigWriteFunnelProvider`. Production
   * code reads the funnel from context — leave this `undefined` and let
   * `useConfigWriteFunnelOptional()` resolve it.
   */
  writeFunnel?: ConfigWriteFunnel | null;
}

export function useConfigSync({
  dataPath,
  target,
  task,
  overrides,
  cv,
  blocked,
  uiSchema,
  onDataChanged,
  writeFunnel: writeFunnelOverride,
}: UseConfigSyncParams) {
  const queryClient = useQueryClient();
  // P-0092 Q-1 Phase 5: `abortRef` now only guards the GET pre-fetch
  // (`fetchConfig` / `fetchConfigDefaults`). The PUT itself rides the
  // funnel, where same-reason coalescing collapses bursts of cv-change
  // events into a single in-flight PUT. The previous AbortController-
  // based race guard was an early sketch of what the funnel now owns
  // properly: when a second cv-change lands while the first is still
  // flushing, the funnel coalesces them into the latest snapshot, so
  // we no longer need to abort the first PUT mid-wire.
  const abortRef = useRef<AbortController | null>(null);
  const prevCvStrategyRef = useRef<string>(cv.strategy);
  const skipNextSyncRef = useRef(false);
  const prevSyncKey = useRef("");

  // P-0092 Q-1 Phase 5: pull the optional write funnel from the
  // Workspace-level provider so cv-change PUTs serialise behind any
  // in-flight target-select / config-form-edit / auto-reset writers.
  // When no provider is mounted (test paths) we fall back to the
  // legacy direct `updateConfig` + `setQueryData` pair.
  const contextFunnel = useConfigWriteFunnelOptional();
  const writeFunnel =
    writeFunnelOverride !== undefined ? writeFunnelOverride : contextFunnel;

  // H-0076: field list comes from the backend UiSchema. ``undefined``
  // falls through to the legacy "emit whatever CvState provides" path.
  const strategyFields = uiSchema?.capabilities?.cv_strategy_fields?.[
    cv.strategy
  ] as readonly string[] | undefined;

  const syncConfig = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let base = await fetchConfig({ signal: controller.signal });
      if (controller.signal.aborted) return;

      const hasConfigVersion =
        (base as Record<string, unknown>).config_version !== undefined;
      if (!hasConfigVersion && task && target) {
        base = await fetchConfigDefaults(task, target);
      }

      const merged = buildSyncedConfig({
        base: base as Record<string, unknown>,
        dataPath,
        target,
        task,
        overrides,
        cv,
        blocked,
        strategyFields,
      });

      // Issue #272 (root cause): the cv-strategy-change inner_valid
      // auto-switch was writing to ``training.inner_valid`` (top-level).
      // The Pydantic schema accepts inner_valid at
      // ``training.early_stopping.inner_valid`` only, so the PUT
      // returned ``saved=false`` with "Extra inputs are not permitted".
      // The user's task change therefore never landed even though
      // useConfigSync emitted the correct ``task`` field — the whole
      // body was rejected. Move the inner_valid mutation under
      // ``early_stopping`` so the PUT lands cleanly.
      const baseTraining = (merged.training as Record<string, unknown>) ?? {};
      const baseEarlyStopping =
        (baseTraining.early_stopping as Record<string, unknown>) ?? {};
      const innerValid =
        (baseEarlyStopping.inner_valid as Record<string, unknown>) ?? {};
      if (prevCvStrategyRef.current !== cv.strategy) {
        const recommended = recommendedInnerValid(cv.strategy);
        // P-0092 follow-up (2026-04-30): prune inner_valid fields to
        // the new method's allowed schema and drop validation_ratio.
        //
        // Without the prune, fields like `stratify` carry over from
        // holdout into group_holdout and get rejected with "Extra
        // inputs are not permitted" because GroupHoldoutInnerValidConfig
        // has extra="forbid".
        //
        // Without the validation_ratio drop, EarlyStoppingConfig's
        // `_resolve_validation_ratio` model_validator rejects the body
        // with "Specify either 'validation_ratio' or 'inner_valid',
        // not both" — except for the holdout method where
        // ratio==validation_ratio short-circuits to round-trip OK.
        // group_holdout / time_holdout always trip the validator.
        const {
          validation_ratio: _validation_ratio,
          ...earlyStoppingWithoutVr
        } = baseEarlyStopping;
        merged.training = {
          ...baseTraining,
          early_stopping: {
            ...earlyStoppingWithoutVr,
            inner_valid: pruneInnerValidForMethod(innerValid, recommended),
          },
        };
        prevCvStrategyRef.current = cv.strategy;
      }
      // P-0092 Q-1 Phase 5: route the merged-config PUT through the
      // funnel when one is mounted. Same-reason coalescing collapses
      // a burst of cv-change events into the latest snapshot, and
      // different-reason ops (target-select / config-form-edit /
      // auto-reset) serialise behind any in-flight cv-change so the
      // (1)↔(2)↔(3) writer triangle the §P-0092 plan diagnoses can
      // no longer cross-stomp. The funnel's `onWriteCommitted` writes
      // the saved snapshot to the React Query cache, so the legacy
      // `setQueryData` is no longer needed in that path.
      //
      // The legacy fallback (`updateConfig` + `setQueryData`) stays
      // for test paths that mount the hook without a Provider; those
      // tests assert the merged config via the legacy seam.
      let putError: unknown = null;
      if (writeFunnel) {
        const result = await writeFunnel.enqueueWrite({
          kind: "replace",
          config: merged,
          reason: "cv-change",
        });
        if (!result.ok) {
          putError = result.details;
        }
      } else {
        try {
          await updateConfig(merged, { signal: controller.signal });
          if (controller.signal.aborted) return;
          // P-0090 / Issue #278 residual: write the merged config to
          // the cache atomically with the PUT so ConfigForm's stale-
          // snapshot effects (inner_valid reset, calibration auto-
          // clear) don't race a second PUT through
          // useModelPanelData.handleConfigChange that reverts the
          // user's just-applied CV strategy or task.
          queryClient.setQueryData(queryKeys.config(), merged);
        } catch (err) {
          putError = err;
        }
      }
      if (putError) {
        if (putError instanceof DOMException && putError.name === "AbortError")
          return;
        if (
          putError instanceof ApiError &&
          putError.status === 409 &&
          isStudioError(putError.body) &&
          putError.body.error.code === "WORKSPACE_LOCKED"
        ) {
          toast.info("Config is locked while a job is running");
          return;
        }
        toast.error("Config sync failed — changes may not be saved");
        return;
      }
      onDataChanged();
    } catch (err) {
      // GET-side failures (fetchConfig / fetchConfigDefaults) and
      // any other thrown exceptions land here. PUT errors are now
      // surfaced via the inline `putError` check above so the funnel
      // path can short-circuit without throwing.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // P-0089 / Issue #279: while a fit/tune job holds the active
      // slot, the GET /config defaults endpoint can also surface
      // 409 WORKSPACE_LOCKED. The disabled controls upstream already
      // explain the lock to the user; emit a quiet info toast
      // instead of the generic error so the user is not alarmed by
      // their own locked-state behaving correctly.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        isStudioError(err.body) &&
        err.body.error.code === "WORKSPACE_LOCKED"
      ) {
        toast.info("Config is locked while a job is running");
        return;
      }
      toast.error("Config sync failed — changes may not be saved");
    }
  }, [
    dataPath,
    target,
    task,
    overrides,
    cv,
    blocked,
    strategyFields,
    onDataChanged,
    queryClient,
    writeFunnel,
  ]);

  // H-0076: key suffix that makes the dedup guard resync when
  // UiSchema's ``cv_strategy_fields`` resolves after the initial
  // render. Without this, the first post-load sync would be skipped
  // because ``buildSyncKey`` alone has not changed, leaving the last
  // PUT based on the pre-UiSchema fallback.
  const fieldsKeyFragment = `|fields=${JSON.stringify(strategyFields ?? null)}`;

  useEffect(() => {
    if (!target) return;
    const key =
      buildSyncKey(target, task, overrides, cv, blocked) + fieldsKeyFragment;
    if (key === prevSyncKey.current) return;
    prevSyncKey.current = key;
    if (skipNextSyncRef.current) {
      return;
    }
    syncConfig();
  }, [target, task, overrides, cv, blocked, fieldsKeyFragment, syncConfig]);

  const setSyncSuppressed = useCallback((flag: boolean) => {
    skipNextSyncRef.current = flag;
  }, []);

  const preseedSyncKey = useCallback(
    (key: string) => {
      // Apply the same fields suffix the useEffect above uses so the
      // preseeded key matches the key the dedup guard will compute on
      // the next render. Without this, a caller that preseeds with
      // ``buildSyncKey(...)`` sees the next render re-fire the sync
      // because of the mismatching suffix.
      prevSyncKey.current = key + fieldsKeyFragment;
    },
    [fieldsKeyFragment],
  );

  return {
    syncConfig,
    setSyncSuppressed,
    preseedSyncKey,
  };
}
