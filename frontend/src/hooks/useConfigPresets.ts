import { useCallback, useState } from "react";

const STORAGE_KEY = "lizystudio-config-presets";

interface ConfigPreset {
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
}

function loadPresets(): ConfigPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ConfigPreset[]) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: ConfigPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage unavailable
  }
}

/**
 * Manage named config presets in localStorage.
 */
export function useConfigPresets() {
  const [presets, setPresets] = useState<ConfigPreset[]>(loadPresets);

  const save = useCallback(
    (name: string, config: Record<string, unknown>) => {
      const updated = [
        ...presets.filter((p) => p.name !== name),
        { name, config, createdAt: new Date().toISOString() },
      ];
      savePresets(updated);
      setPresets(updated);
    },
    [presets],
  );

  const remove = useCallback(
    (name: string) => {
      const updated = presets.filter((p) => p.name !== name);
      savePresets(updated);
      setPresets(updated);
    },
    [presets],
  );

  const load = useCallback(
    (name: string): Record<string, unknown> | null => {
      return presets.find((p) => p.name === name)?.config ?? null;
    },
    [presets],
  );

  return { presets, save, remove, load };
}
