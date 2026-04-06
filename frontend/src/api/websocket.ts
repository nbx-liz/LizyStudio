import type { WsMessage } from "./types";

const MAX_RETRIES = 10;
const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;

/**
 * Connect to job progress WebSocket with exponential backoff
 * reconnection (H-0035).
 */
export function connectJobProgress(
  jobId: string,
  callbacks: {
    onProgress?: (msg: WsMessage & { type: "progress" }) => void;
    onCompleted?: (msg: WsMessage & { type: "completed" }) => void;
    onError?: (msg: WsMessage & { type: "error" }) => void;
    onReconnect?: () => void;
  },
): () => void {
  let ws: WebSocket | null = null;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  // Suppress reconnection after terminal messages (completed/error)
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
          message: "WebSocket connection lost after maximum retries",
        } as WsMessage & { type: "error" });
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
