import { useCallback } from "react";

/**
 * Send a browser notification when the tab is not focused.
 * Requests permission on first call if not yet granted.
 *
 * Issue #339: returned function is wrapped in ``useCallback`` so
 * downstream ``useCallback`` consumers (handleJobDone → onTerminal →
 * fireTerminal in useJobProgress) keep stable references across
 * parent re-renders. Without this, every WorkspacePage re-render
 * propagated a new reference all the way down and re-ran the WS
 * subscription effect, which then re-subscribed and received the
 * server's PR #329 cached terminal replay — fanning out into a
 * polling storm of ``invalidateQueries`` calls.
 */
export function useBackgroundNotification() {
  return useCallback((title: string, body?: string) => {
    if (typeof Notification === "undefined") return;
    if (document.hasFocus()) return;

    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification(title, { body, icon: "/favicon.ico" });
        }
      });
    }
  }, []);
}
