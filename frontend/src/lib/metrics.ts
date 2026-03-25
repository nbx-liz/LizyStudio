/**
 * Pivot backend metrics structure into ScoreSection format.
 * Backend returns: { "raw": { "if_mean": {auc: 0.9}, "oof": {auc: 0.8}, "oof_std": {auc: 0.01} } }
 * ScoreSection expects: { "auc": { is: 0.9, oos: 0.8, oos_std: 0.01 } }
 */
export function pivotMetrics(
  raw: Record<string, unknown>,
): Record<string, Record<string, number>> {
  // Unwrap the top-level key (e.g. "raw") if present
  const keys = Object.keys(raw);
  const nested =
    keys.length === 1 &&
    typeof raw[keys[0]] === "object" &&
    raw[keys[0]] != null
      ? (raw[keys[0]] as Record<string, unknown>)
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
