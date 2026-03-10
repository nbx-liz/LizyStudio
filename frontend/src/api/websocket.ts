import type { WsMessage } from "./types";

export function connectJobProgress(
  jobId: string,
  callbacks: {
    onProgress?: (msg: WsMessage & { type: "progress" }) => void;
    onCompleted?: (msg: WsMessage & { type: "completed" }) => void;
    onError?: (msg: WsMessage & { type: "error" }) => void;
  },
): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws/jobs/${jobId}/progress`;
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WsMessage;
      switch (msg.type) {
        case "progress":
          callbacks.onProgress?.(msg);
          break;
        case "completed":
          callbacks.onCompleted?.(msg);
          break;
        case "error":
          callbacks.onError?.(msg);
          break;
      }
    } catch {
      // ignore unparseable messages
    }
  };

  ws.onerror = () => {
    // fallback to polling handled by caller
  };

  return () => {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
    }
  };
}
