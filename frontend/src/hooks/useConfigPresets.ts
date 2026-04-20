import { useCallback, useState } from "react";

const STORAGE_KEY = "lizystudio-config-presets";

export interface ConfigPreset {
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
}

// CRITICAL-5: ML configs can include the user-selected data path, the
// list of excluded feature columns, and other project-specific context
// that should never be persisted to localStorage (XSS would otherwise
// leak it to any attacker who lands a script on the page). Only the
// ML-tuning portion of the config is worth saving as a "preset".
const SENSITIVE_KEYS = new Set(["data", "features"]);

function sanitizeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    safe[key] = value;
  }
  return safe;
}

function sanitizePreset(preset: ConfigPreset): ConfigPreset {
  return { ...preset, config: sanitizeConfig(preset.config) };
}

function loadPresets(): ConfigPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ConfigPreset[];
    // Migrate legacy presets on read so previously-written secrets are
    // dropped the next time this hook runs.
    return parsed.map(sanitizePreset);
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
      const sanitized = sanitizeConfig(config);
      const updated = [
        ...presets.filter((p) => p.name !== name),
        { name, config: sanitized, createdAt: new Date().toISOString() },
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
