import type { WsMessage } from "./types";

const INITIAL_DELAY = 1000;
// P-0099 v3-23a (R-2.1): cap individual reconnect delay at 5 minutes
// to bound the worst-case time-to-recover for long-running tune jobs.
// Spec: docs/v0.4-business-readiness-plan.md §3.1 — "最大 reconnect
// interval 5min". Backend ``_last_terminal`` cache TTL is also 5 min,
// so a reconnect within this window still observes terminal events
// even when the live broadcast lost the subscribe-vs-send race.
const MAX_DELAY = 5 * 60 * 1000; // 5 minutes
// Random jitter (±JITTER_RATIO * delay) prevents thundering herd when
// a network outage forces every tab to reconnect at the same instant.
const JITTER_RATIO = 0.15;

/**
 * Connect to job progress WebSocket with exponential backoff
 * reconnection (H-0035, P-0099 v3-23a).
 *
 * Reconnect schedule:
 *   1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 300s, 300s, ... (capped
 *   at 5 minutes), with ±15% jitter on each delay. Retries continue
 *   indefinitely — the worker thread on the server is the source of
 *   truth for job lifetime, not the WebSocket connection (INV-7).
 *   The cleanup function returned from this call is the only way to
 *   stop reconnect attempts.
 *
 * Terminal-message handling:
 *   - ``completed`` / ``error``: stop reconnecting (job is done).
 *   - ``paused`` (P-0099 v3-20e): do NOT stop — paused is resumable,
 *     and the WS stream picks up live progress when the user clicks
 *     Resume on the same connection.
 *
 * Missed-message recovery (DoD R-2.1):
 *   - Terminal events that fired during a disconnect are replayed by
 *     the backend's ``_last_terminal`` cache (5-min TTL) on the next
 *     subscribe — same as Issue #327's existing late-subscriber path.
 *   - In-flight progress events are NOT buffered; reconnect resumes
 *     the live stream from the worker's current trial. The
 *     ``useJobProgress`` polling fallback re-fetches the job state
 *     on terminal transitions so a long disconnect that exceeds the
 *     terminal cache TTL still surfaces the final status via the
 *     jobs cache invalidation.
 */
export function connectJobProgress(
  jobId: string,
  callbacks: {
    onProgress?: (msg: WsMessage & { type: "progress" }) => void;
    onCompleted?: (msg: WsMessage & { type: "completed" }) => void;
    onError?: (msg: WsMessage & { type: "error" }) => void;
    onPaused?: (msg: WsMessage & { type: "paused" }) => void;
    onReconnect?: () => void;
  },
): () => void {
  let ws: WebSocket | null = null;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  // Suppress reconnection after terminal messages (completed/error).
  // Pause is non-terminal — see the case "paused" branch below.
  let jobDone = false;

  function connect() {
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/jobs/${jobId}/progress`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      retryCount = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        switch (msg.type) {
          case "progress":
            callbacks.onProgress?.(msg);
            break;
          case "completed":
            jobDone = true;
            callbacks.onCompleted?.(msg);
            break;
          case "error":
            jobDone = true;
            callbacks.onError?.(msg);
            break;
          case "paused":
            // Non-terminal: do NOT set jobDone, keep the WS open so
            // the live stream resumes when the user clicks Resume.
            callbacks.onPaused?.(msg);
            break;
        }
      } catch {
        // ignore unparseable messages (including ping)
      }
    };

    ws.onclose = () => {
      if (closed || jobDone) return;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  /**
   * Compute the next reconnect delay with exponential backoff + jitter.
   * Exposed via closure for test injection (the unit tests stub
   * ``Math.random`` to verify the jitter range).
   */
  function nextDelay(): number {
    const base = Math.min(INITIAL_DELAY * 2 ** retryCount, MAX_DELAY);
    // Jitter spans [-JITTER_RATIO, +JITTER_RATIO] of base.
    const jitter = base * JITTER_RATIO * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  function scheduleReconnect() {
    if (closed) return;
    const delay = nextDelay();
    retryCount++;
    retryTimer = setTimeout(() => {
      callbacks.onReconnect?.();
      connect();
    }, delay);
  }

  connect();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      ws.close();
    }
  };
}
