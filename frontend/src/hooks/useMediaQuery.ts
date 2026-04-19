import { useSyncExternalStore } from "react";

// Issue #178: drives the mobile-vs-desktop Workspace layout swap and
// any other viewport-dependent rendering. Uses `useSyncExternalStore`
// so the initial render matches the current viewport without a layout
// thrash on mount.

function subscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return () => {};
    }
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  };
}

function getSnapshot(query: string) {
  return () => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return false;
    }
    return window.matchMedia(query).matches;
  };
}

// Server snapshot — the hook assumes a client-side render by default.
// If any consumer ever adopts SSR, override this via a prop or context.
function getServerSnapshot() {
  return false;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    getSnapshot(query),
    getServerSnapshot,
  );
}
