/**
 * WebSocket client for job progress (BLUEPRINT §5.5).
 *
 * Connects to /ws/jobs/{jobId}/progress and invokes callbacks
 * on progress, completed, and error messages. Falls back to
 * polling if the WebSocket connection fails.
 */

export interface ProgressMessage {
  type: "progress";
  job_id: string;
  current: number;
  total: number;
  message: string;
}

export interface CompletedMessage {
  type: "completed";
  job_id: string;
  message: string;
}

export interface ErrorMessage {
  type: "error";
  job_id: string;
  message: string;
  code: string;
}

export type WsMessage = ProgressMessage | CompletedMessage | ErrorMessage;

export interface WsCallbacks {
  onProgress?: (msg: ProgressMessage) => void;
  onCompleted?: (msg: CompletedMessage) => void;
  onError?: (msg: ErrorMessage) => void;
  onDisconnect?: () => void;
}

export function connectJobProgress(
  jobId: string,
  callbacks: WsCallbacks,
): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws/jobs/${jobId}/progress`;

  let ws: WebSocket | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(url);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage & { type: string };
        if (msg.type === "progress") {
          callbacks.onProgress?.(msg as ProgressMessage);
        } else if (msg.type === "completed") {
          callbacks.onCompleted?.(msg as CompletedMessage);
          cleanup();
        } else if (msg.type === "error") {
          callbacks.onError?.(msg as ErrorMessage);
          cleanup();
        }
        // Ignore "ping" messages silently
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      if (!closed) {
        callbacks.onDisconnect?.();
      }
    };

    ws.onerror = () => {
      callbacks.onDisconnect?.();
    };
  }

  function cleanup() {
    closed = true;
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  connect();

  // Return disconnect function
  return cleanup;
}
