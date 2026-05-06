import type { WsMessage } from "./types";

const MAX_RETRIES = 10;
const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;

/**
 * Connect to job progress WebSocket with exponential backoff
 * reconnection (H-0035).
 *
 * P-0099 v3-20e: ``paused`` is a NON-terminal message — the WS
 * connection stays open so the frontend can observe the live progress
 * stream after the user clicks Resume.  Only ``completed`` / ``error``
 * suppress the reconnect path.
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

  function scheduleReconnect() {
    if (closed || retryCount >= MAX_RETRIES) {
      if (retryCount >= MAX_RETRIES) {
        callbacks.onError?.({
          type: "error",
          job_id: jobId,
          message: "WebSocket connection lost after maximum retries",
          code: "WS_RECONNECT_FAILED",
        });
      }
      return;
    }
    const delay = Math.min(INITIAL_DELAY * 2 ** retryCount, MAX_DELAY);
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
