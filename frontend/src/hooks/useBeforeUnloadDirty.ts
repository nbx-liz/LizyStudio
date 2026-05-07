import { useEffect } from "react";

/**
 * Show the browser's native "leave this page?" confirm dialog when
 * `isDirty()` returns true at unload time (P-0102 INV-reload-4).
 *
 * The Workspace funnel auto-saves user edits on a microtask boundary
 * after each `onChange`, but a burst of edits coalesced into a single
 * pending PUT can still be in-flight when the user reloads. Calling
 * `event.preventDefault()` and assigning `event.returnValue` arms
 * Chromium / WebKit / Firefox to surface their default confirmation
 * dialog. Modern browsers ignore custom messages — only the boolean
 * "is this page dirty?" signal matters.
 *
 * `isDirty` is read at unload time so the consumer can derive the
 * answer from a ref / funnel getter without re-registering the
 * listener on every render. This also matches the funnel's
 * `isFlushing()` shape, which is itself a getter rather than reactive
 * state.
 */
export function useBeforeUnloadDirty(isDirty: () => boolean): void {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      // Legacy Chromium / Safari path: returnValue must be set to
      // anything truthy. The string itself is ignored by modern
      // browsers, but assignment is what triggers the dialog there.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}
