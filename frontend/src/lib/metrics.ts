/**
 * Pivot backend metrics structure into ScoreSection format.
 *
 * Backend returns one of:
 *   - ``{raw: {if_mean, oof, oof_std}}`` — uncalibrated single tree
 *   - ``{raw: {...}, calibrated: {...}}`` — calibration enabled.
 *     Earlier this fell through to the "multiple top-level keys" branch
 *     and refused to unwrap, leaving every metric as ``NaN`` so the
 *     Score / Metric panel rendered empty.
 *   - ``{if_mean, oof, oof_std}`` — flat shape (some legacy callers)
 *
 * ScoreSection expects: ``{auc: {is: 0.9, oos: 0.8, oos_std: 0.01}}``.
 *
 * Always prefer the canonical ``raw`` sub-tree when present so the
 * panel reads the same uncalibrated numbers users see during a
 * non-calibrated fit, regardless of whether ``calibrated`` is also
 * emitted alongside.
 */
export function pivotMetrics(
  raw: Record<string, unknown>,
): Record<string, Record<string, number>> {
  // Prefer the canonical ``raw`` sub-tree when present (covers both the
  // single-key and the calibration-enabled multi-key shapes). Fall back
  // to the top level for the flat shape.
  const nested =
    typeof raw.raw === "object" && raw.raw !== null
      ? (raw.raw as Record<string, unknown>)
      : raw;

  const ifMean = (nested.if_mean ?? nested.is ?? {}) as Record<string, number>;
  const oof = (nested.oof ?? nested.oos ?? {}) as Record<string, number>;
  const oofStd = (nested.oof_std ?? nested.oos_std ?? {}) as Record<
    string,
    number
  >;

  const metricNames = new Set([
    ...Object.keys(ifMean),
    ...Object.keys(oof),
    ...Object.keys(oofStd),
  ]);

  const result: Record<string, Record<string, number>> = {};
  for (const name of metricNames) {
    result[name] = {
      is: ifMean[name] ?? Number.NaN,
      oos: oof[name] ?? Number.NaN,
      oos_std: oofStd[name] ?? Number.NaN,
    };
  }
  return result;
}
