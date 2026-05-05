import { describe, expect, it } from "vitest";
import type { ConfigError } from "./types";
import { isBlockingError } from "./types";

// Issue #404 follow-up: lock the severity defaulting rule that the
// PR-B4 envelope (P-0100) made canonical. Frontend code paths that
// gate Fit / Tune / Save on validation entries must treat missing
// ``severity`` as ``"error"`` for backward compatibility with older
// backend builds; ``"warning"`` and ``"info"`` advise but do not block.
describe("isBlockingError", () => {
  it("treats a missing severity as error (legacy backend default)", () => {
    const err: ConfigError = { path: "split.n_splits", message: "bad" };
    expect(isBlockingError(err)).toBe(true);
  });

  it("blocks when severity is 'error'", () => {
    const err: ConfigError = {
      path: "split.n_splits",
      message: "n_splits > n_rows",
      severity: "error",
    };
    expect(isBlockingError(err)).toBe(true);
  });

  it("does not block when severity is 'warning'", () => {
    const err: ConfigError = {
      path: "evaluation.metrics",
      message: "MAPE undefined when target contains zeros",
      severity: "warning",
      suggested_fix: "Use 'smape' or 'wape' instead (lizyml 0.11.0+).",
    };
    expect(isBlockingError(err)).toBe(false);
  });

  it("does not block when severity is 'info'", () => {
    const err: ConfigError = {
      path: "evaluation.metrics",
      message: "Heads up — this metric is preview-only.",
      severity: "info",
    };
    expect(isBlockingError(err)).toBe(false);
  });
});
