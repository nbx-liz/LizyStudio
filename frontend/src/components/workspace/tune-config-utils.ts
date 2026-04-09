/** Pure helper functions for reading/updating the tuning config tree. */

/** Update tuning.optuna.{params|space} (NOT evaluation — that goes to tuning.evaluation). */
export function updateOptunaField(
  config: Record<string, unknown>,
  path: "params" | "space",
  value: unknown,
): Record<string, unknown> {
  const tuning = (config.tuning as Record<string, unknown>) ?? {};
  const optuna = (tuning.optuna as Record<string, unknown>) ?? {};
  return {
    ...config,
    tuning: { ...tuning, optuna: { ...optuna, [path]: value } },
  };
}

/** Update tuning.{field} (e.g. tuning.evaluation — Widget conformance). */
export function updateTuningField(
  config: Record<string, unknown>,
  field: string,
  value: unknown,
): Record<string, unknown> {
  const tuning = (config.tuning as Record<string, unknown>) ?? {};
  return { ...config, tuning: { ...tuning, [field]: value } };
}

export function extractOptunaField<T>(
  config: Record<string, unknown>,
  field: string,
  fallback: T,
): T {
  const tuning = config.tuning as Record<string, unknown> | undefined;
  const optuna = tuning?.optuna as Record<string, unknown> | undefined;
  return (optuna?.[field] as T) ?? fallback;
}

/** Extract tuning.{field} (for evaluation — Widget conformance). */
export function extractTuningField<T>(
  config: Record<string, unknown>,
  field: string,
  fallback: T,
): T {
  const tuning = config.tuning as Record<string, unknown> | undefined;
  return (tuning?.[field] as T) ?? fallback;
}
