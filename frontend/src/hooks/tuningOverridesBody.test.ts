import { describe, expect, it } from "vitest";
import { tuningOverridesFromConfig } from "./tuningOverridesBody";

/**
 * P-0111: the overrides body mirrors the backend's
 * `extract_overrides_from_legacy_tuning`, so the endpoint stores the same
 * intent the legacy `PUT /config` absorb shim stored for the same config.
 */
describe("tuningOverridesFromConfig", () => {
  it("maps the five tuning fields from the legacy nested block", () => {
    expect(
      tuningOverridesFromConfig({
        task: "binary",
        tuning: {
          optuna: {
            params: { n_trials: 30, timeout: 600, direction: "maximize" },
            space: { num_leaves: { type: "int", low: 8, high: 64 } },
          },
          evaluation: { metrics: ["auc", "logloss"] },
        },
      }),
    ).toEqual({
      n_trials: 30,
      timeout: 600,
      direction: "maximize",
      space: { num_leaves: { type: "int", low: 8, high: 64 } },
      evaluation_metrics: ["auc", "logloss"],
    });
  });

  it("emits only the fields present, so untouched fields stay unset (sparse)", () => {
    expect(
      tuningOverridesFromConfig({
        tuning: { optuna: { params: { n_trials: 10 } } },
      }),
    ).toEqual({ n_trials: 10 });
  });

  it("keeps an explicit null, which the backend reads as an explicit intent", () => {
    expect(
      tuningOverridesFromConfig({
        tuning: { optuna: { params: { timeout: null } } },
      }),
    ).toEqual({ timeout: null });
  });

  it("drops an empty space and non-object space entries", () => {
    expect(
      tuningOverridesFromConfig({ tuning: { optuna: { space: {} } } }),
    ).toEqual({});
    expect(
      tuningOverridesFromConfig({
        tuning: {
          optuna: { space: { a: { type: "float" }, b: 3, c: null } },
        },
      }),
    ).toEqual({ space: { a: { type: "float" } } });
  });

  it("keeps an explicitly cleared metric list as []", () => {
    expect(
      tuningOverridesFromConfig({ tuning: { evaluation: { metrics: [] } } }),
    ).toEqual({ evaluation_metrics: [] });
  });

  it("never carries the non-overrides keys (re_tune, model_params, training)", () => {
    expect(
      tuningOverridesFromConfig({
        tuning: {
          re_tune: { n_rounds: 3 },
          model_params: { num_leaves: 15 },
          training: { seed: 1 },
          optuna: { params: { n_trials: 4, study_name: "x" } },
        },
      }),
    ).toEqual({ n_trials: 4 });
  });

  it("returns an empty intent for a config without a tuning block", () => {
    expect(tuningOverridesFromConfig(undefined)).toEqual({});
    expect(tuningOverridesFromConfig({ task: "binary" })).toEqual({});
    expect(tuningOverridesFromConfig({ tuning: [] })).toEqual({});
  });
});
