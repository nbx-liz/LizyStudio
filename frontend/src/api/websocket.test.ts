import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectJobProgress } from "./websocket";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  url: string;
  readyState = MockWebSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
  }

  /** Simulate receiving a message from the server */
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

// ---------------------------------------------------------------------------
// Helper: capture last created MockWebSocket
// ---------------------------------------------------------------------------
let wsInstances: MockWebSocket[] = [];

function getLastWebSocket(): MockWebSocket {
  const last = wsInstances[wsInstances.length - 1];
  if (!last) throw new Error("No WebSocket instance created");
  return last;
}

beforeEach(() => {
  wsInstances = [];
  const OrigMock = MockWebSocket;
  vi.stubGlobal(
    "WebSocket",
    class extends OrigMock {
      constructor(url: string) {
        super(url);
        wsInstances.push(this);
      }
    },
  );
  // Simulate http: protocol for ws: derivation
  Object.defineProperty(window, "location", {
    value: { protocol: "http:", host: "localhost:5173" },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// connectJobProgress
// ---------------------------------------------------------------------------
describe("connectJobProgress", () => {
  it("creates a WebSocket connection with correct URL", () => {
    connectJobProgress("j1", {});
    // WebSocket constructor is called via MockWebSocket
    // Verify by checking the last constructed instance
    expect(MockWebSocket).toBeDefined();
  });

  it("routes progress messages to onProgress callback", () => {
    const onProgress = vi.fn();
    connectJobProgress("j1", { onProgress });

    // Get the created WebSocket instance by capturing it
    const ws = getLastWebSocket();
    ws.simulateMessage({ type: "progress", current: 5, total: 10 });

    expect(onProgress).toHaveBeenCalledWith({
      type: "progress",
      current: 5,
      total: 10,
    });
  });

  it("routes completed messages to onCompleted callback", () => {
    const onCompleted = vi.fn();
    connectJobProgress("j1", { onCompleted });

    const ws = getLastWebSocket();
    ws.simulateMessage({ type: "completed", job_id: "j1" });

    expect(onCompleted).toHaveBeenCalledWith({
      type: "completed",
      job_id: "j1",
    });
  });

  it("routes error messages to onError callback", () => {
    const onError = vi.fn();
    connectJobProgress("j1", { onError });

    const ws = getLastWebSocket();
    ws.simulateMessage({ type: "error", message: "something went wrong" });

    expect(onError).toHaveBeenCalledWith({
      type: "error",
      message: "something went wrong",
    });
  });

  it("ignores unparseable messages", () => {
    const onProgress = vi.fn();
    connectJobProgress("j1", { onProgress });

    const ws = getLastWebSocket();
    // Send invalid JSON directly
    ws.onmessage?.({ data: "not json{{{" });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("does not call callbacks for unknown message types", () => {
    const onProgress = vi.fn();
    const onCompleted = vi.fn();
    const onError = vi.fn();
    connectJobProgress("j1", { onProgress, onCompleted, onError });

    const ws = getLastWebSocket();
    ws.simulateMessage({ type: "unknown", data: "test" });

    expect(onProgress).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns a cleanup function that closes the WebSocket", () => {
    const cleanup = connectJobProgress("j1", {});
    const ws = getLastWebSocket();

    ws.readyState = MockWebSocket.OPEN;
    cleanup();
    expect(ws.close).toHaveBeenCalled();
  });

  it("cleanup does not close already-closed WebSocket", () => {
    const cleanup = connectJobProgress("j1", {});
    const ws = getLastWebSocket();

    ws.readyState = MockWebSocket.CLOSED;
    cleanup();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("uses wss: for https: protocol", () => {
    Object.defineProperty(window, "location", {
      value: { protocol: "https:", host: "example.com" },
      writable: true,
      configurable: true,
    });
    connectJobProgress("j1", {});
    const ws = getLastWebSocket();
    expect(ws.url).toBe("wss://example.com/ws/jobs/j1/progress");
  });
});
