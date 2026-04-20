/**
 * WebSocket progress subscription + terminal-state fallback detection.
 *
 * Collapses the near-duplicate ``useEffect`` blocks that ResultsPanel
 * and JobDetail each owned:
 *   - subscribe to ``connectJobProgress`` when the job is running /
 *     pending (ResultsPanel also subscribed while the job was still
 *     undefined so a fast-completing re-tune child never lost events)
 *   - clear the in-memory ``progress`` state when a terminal message
 *     arrives
 *   - polling fallback: when the job status transitions to terminal
 *     via ``useJob``'s refetchInterval (the WebSocket may have missed
 *     the final message), fire the ``onTerminal`` callback and reset
 *     progress
 *
 * Before B-2, ResultsPanel considered ``prev === undefined`` to be a
 * valid "first observation of a terminal job" edge case (user clicks
 * on a re-tune child that already finished). JobDetail required
 * ``prev === "running"`` strictly, so that edge case silently no-oped.
 * This hook standardises on the more permissive detection.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { queryKeys } from "@/api/queryKeys";
import type { JobDetail, ProgressMessage } from "@/api/types";
import { connectJobProgress } from "@/api/websocket";

export interface UseJobProgressParams {
  jobId: string | null;
  job: JobDetail | undefined;
  /** Called whenever a terminal state is reached (via WS or polling). */
  onTerminal?: () => void;
  /** When true, accumulate progress ``message`` strings into a log. */
  trackFoldLog?: boolean;
  /** Optional surface for WS ``error`` messages (e.g. toast). */
  onWsError?: (message: string) => void;
}

export interface UseJobProgress {
  progress: ProgressMessage | null;
  foldLog: string[];
  /** Manually clear the transient progress state (used by cancel). */
  clearProgress: () => void;
}

function _isTerminal(status: string | undefined): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function useJobProgress({
  jobId,
  job,
  onTerminal,
  trackFoldLog = false,
  onWsError,
}: UseJobProgressParams): UseJobProgress {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ProgressMessage | null>(null);
  const [foldLog, setFoldLog] = useState<string[]>([]);

  // Per-job guard so we never fire ``onTerminal`` twice for the same job
  // when BOTH the WebSocket ``completed`` message AND the polling-
  // fallback effect observe the terminal transition (which happens on
  // every successful cancel / completion because ``onCompleted``
  // invalidates the job query, which then flips ``job.status`` and
  // triggers the polling effect with ``prev === "running"``).
  const terminalFiredRef = useRef<string | null>(null);
  const fireTerminal = useCallback(() => {
    if (terminalFiredRef.current === jobId) return;
    terminalFiredRef.current = jobId;
    onTerminal?.();
  }, [jobId, onTerminal]);

  // ------------------------------------------------------------------
  // WebSocket subscription
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!jobId) return;
    // Optimistically subscribe even while the job is still undefined
    // (child job just selected, first fetch has not resolved yet) —
    // without this a fast-completing re-tune child could drop its
    // events. If we already know the job is terminal, skip.
    if (job?.status && _isTerminal(job.status)) return;

    const disconnect = connectJobProgress(jobId, {
      onProgress: (msg) => {
        setProgress(msg);
        if (trackFoldLog && msg.message) {
          setFoldLog((prev) => {
            const last = prev[prev.length - 1];
            if (last === msg.message) return prev;
            return [...prev, msg.message as string];
          });
        }
      },
      onCompleted: () => {
        setProgress(null);
        if (trackFoldLog) setFoldLog([]);
        queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
        fireTerminal();
      },
      onError: (msg) => {
        setProgress(null);
        if (trackFoldLog) setFoldLog([]);
        onWsError?.(msg.message);
        queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
        fireTerminal();
      },
    });

    return () => disconnect();
  }, [jobId, job?.status, queryClient, trackFoldLog, fireTerminal, onWsError]);

  // ------------------------------------------------------------------
  // Polling fallback — watch for status transitions into a terminal
  // state that the WebSocket may have missed.
  // ------------------------------------------------------------------
  const prevStatusRef = useRef<string | undefined>(undefined);
  const prevJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset the cached status AND the terminal-fired guard whenever
    // the selected job id changes so a transition from one job to
    // another is not misread as a status transition on the same job,
    // and a new job can still fire ``onTerminal`` once.
    if (prevJobIdRef.current !== jobId) {
      prevJobIdRef.current = jobId;
      prevStatusRef.current = undefined;
      terminalFiredRef.current = null;
    }
    const prev = prevStatusRef.current;
    prevStatusRef.current = job?.status;
    if (!_isTerminal(job?.status)) return;
    // Fire when transitioning TO a terminal state from a non-terminal
    // one, OR when this is the first observation of a job that is
    // already terminal (the child-selection edge case — a fast re-tune
    // child may finish before the frontend subscribes).
    if (prev === undefined || prev === "running" || prev === "pending") {
      setProgress(null);
      if (trackFoldLog) setFoldLog([]);
      fireTerminal();
    }
  }, [jobId, job?.status, fireTerminal, trackFoldLog]);

  return {
    progress,
    foldLog,
    clearProgress: () => {
      setProgress(null);
      if (trackFoldLog) setFoldLog([]);
    },
  };
}
