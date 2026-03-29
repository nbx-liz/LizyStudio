import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 50;

/**
 * Track config changes with undo/redo support.
 * Does NOT manage the config state itself — just records snapshots.
 */
export function useConfigHistory() {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const pastRef = useRef<string[]>([]);
  const futureRef = useRef<string[]>([]);
  const currentRef = useRef<string>("");

  const push = useCallback((config: Record<string, unknown>) => {
    const json = JSON.stringify(config);
    if (json === currentRef.current) return;

    if (currentRef.current) {
      pastRef.current = [
        ...pastRef.current.slice(-(MAX_HISTORY - 1)),
        currentRef.current,
      ];
    }
    currentRef.current = json;
    futureRef.current = [];
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(false);
  }, []);

  const undo = useCallback((): Record<string, unknown> | null => {
    if (pastRef.current.length === 0) return null;
    const prev = pastRef.current.pop() ?? "";
    futureRef.current.push(currentRef.current);
    currentRef.current = prev;
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(true);
    return JSON.parse(prev) as Record<string, unknown>;
  }, []);

  const redo = useCallback((): Record<string, unknown> | null => {
    if (futureRef.current.length === 0) return null;
    const next = futureRef.current.pop() ?? "";
    pastRef.current.push(currentRef.current);
    currentRef.current = next;
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
    return JSON.parse(next) as Record<string, unknown>;
  }, []);

  return { push, undo, redo, canUndo, canRedo };
}
