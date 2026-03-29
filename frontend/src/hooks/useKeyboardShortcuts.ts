import { useEffect } from "react";

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  action: () => void;
}

/**
 * Register global keyboard shortcuts. Cleans up on unmount.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      for (const s of shortcuts) {
        const ctrlMatch = s.ctrl
          ? e.ctrlKey || e.metaKey
          : !e.ctrlKey && !e.metaKey;
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;
        if (e.key === s.key && ctrlMatch && shiftMatch) {
          e.preventDefault();
          s.action();
          return;
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
