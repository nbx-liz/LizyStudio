import type { TuningOverridesBody } from "@/api/workspace";

/**
 * Project a config's legacy ``tuning`` block onto the sparse
 * ``TuningOverrides`` body of ``PUT /config/tuning-overrides`` (P-0111).
 *
 * The endpoint REPLACES the stored intent, so the body must carry every
 * field the user has set, not only the one just edited. The seed is the
 * cached config: its ``tuning`` block is the server's legacy view of the
 * stored overrides (``GET /config`` synthesises it from
 * ``ws.tuning_overrides``), and every committed write (legacy or
 * overrides) updates the cache synchronously, so it is fresh at flush
 * time even inside one funnel drain. The local edit is already applied
 * to it as a funnel patch.
 *
 * The mapping mirrors the backend's ``extract_overrides_from_legacy_tuning``
 * field for field, so the stored intent is what the legacy ``PUT /config``
 * absorb shim stores for the same config, with one difference: the shim
 * also drops a ``direction`` that only repeats the first metric's
 * (``_drop_derived_direction``, P-0116 D5), and the overrides endpoint
 * does not. The Tune tab itself never writes ``direction`` (a metric
 * change removes it), so a derived one reaches this body only from a
 * cached config that carried it, e.g. an old preset; it is then stored
 * as an explicit override with the same effective direction.
 *
 * - ``optuna.params.{n_trials,timeout,direction}`` when the key is present
 *   (an explicit ``null`` is kept: it is an explicit intent);
 * - ``optuna.space`` entries that are objects, when the space is non-empty;
 * - ``evaluation.metrics`` when it is a list.
 *
 * Other ``tuning`` keys (``re_tune``, ``model_params``, ``training``) are
 * not tuning-overrides fields and stay on the legacy path.
 */
export function tuningOverridesFromConfig(
  config: Record<string, unknown> | undefined,
): TuningOverridesBody {
  const tuning = asRecord(config?.tuning);
  if (tuning === null) return {};
  const body: Record<string, unknown> = {};
  const optuna = asRecord(tuning.optuna);
  if (optuna !== null) {
    const params = asRecord(optuna.params);
    if (params !== null) {
      for (const key of ["n_trials", "timeout", "direction"] as const) {
        if (key in params) body[key] = params[key];
      }
    }
    const space = asRecord(optuna.space);
    if (space !== null && Object.keys(space).length > 0) {
      const entries: Record<string, Record<string, unknown>> = {};
      for (const [key, value] of Object.entries(space)) {
        const entry = asRecord(value);
        if (entry !== null) entries[key] = entry;
      }
      body.space = entries;
    }
  }
  const evaluation = asRecord(tuning.evaluation);
  if (evaluation !== null && Array.isArray(evaluation.metrics)) {
    body.evaluation_metrics = [...evaluation.metrics];
  }
  return body as TuningOverridesBody;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
