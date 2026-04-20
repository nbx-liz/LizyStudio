import { describe, expect, it } from "vitest";
import type { JobDetail } from "@/api/types";
import {
  defaultRetuneTrials,
  getConfigSection,
  getDataSection,
  getEvaluationSection,
  getModelName,
  getModelParams,
  getModelSection,
  getTargetColumn,
  remainingRetuneTrials,
} from "./job-config";

function jobWith(
  config: Record<string, unknown> | null | undefined,
): JobDetail {
  return {
    job_id: "test-job",
    job_type: "fit",
    status: "completed",
    backend_name: "lizyml",
    model_name: "lgbm",
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
    error: null,
    primary_score: 0.9,
    parent_job_id: null,
    fit_result: null,
    tune_result: null,
    config,
  } as JobDetail;
}

describe("getConfigSection", () => {
  it("returns the section when it is an object", () => {
    const job = jobWith({ model: { name: "lgbm" } });
    expect(getConfigSection(job, "model")).toEqual({ name: "lgbm" });
  });

  it("returns undefined when the job is nullish", () => {
    expect(getConfigSection(null, "model")).toBeUndefined();
    expect(getConfigSection(undefined, "model")).toBeUndefined();
  });

  it("returns undefined when the section is missing", () => {
    const job = jobWith({});
    expect(getConfigSection(job, "model")).toBeUndefined();
  });

  it("returns undefined when the section is not an object", () => {
    const job = jobWith({ model: "lgbm" });
    expect(getConfigSection(job, "model")).toBeUndefined();
  });

  it("returns undefined when the section is an array", () => {
    const job = jobWith({ model: ["lgbm"] });
    expect(getConfigSection(job, "model")).toBeUndefined();
  });

  it("returns undefined when the config itself is null", () => {
    const job = jobWith(null);
    expect(getConfigSection(job, "model")).toBeUndefined();
  });
});

describe("getModelSection / getModelParams", () => {
  it("returns the model object", () => {
    const job = jobWith({ model: { name: "lgbm", params: { lr: 0.1 } } });
    expect(getModelSection(job)).toEqual({ name: "lgbm", params: { lr: 0.1 } });
  });

  it("returns empty object when model is absent", () => {
    expect(getModelSection(jobWith({}))).toEqual({});
    expect(getModelSection(null)).toEqual({});
  });

  it("returns nested params when present", () => {
    const job = jobWith({ model: { params: { lr: 0.1, num_leaves: 31 } } });
    expect(getModelParams(job)).toEqual({ lr: 0.1, num_leaves: 31 });
  });

  it("returns empty object when params are absent or malformed", () => {
    expect(getModelParams(jobWith({ model: {} }))).toEqual({});
    expect(getModelParams(jobWith({ model: { params: "oops" } }))).toEqual({});
    expect(getModelParams(null)).toEqual({});
  });
});

describe("getEvaluationSection / getDataSection", () => {
  it("returns the evaluation object", () => {
    const job = jobWith({ evaluation: { metrics: ["auc"] } });
    expect(getEvaluationSection(job)).toEqual({ metrics: ["auc"] });
  });

  it("returns the data object", () => {
    const job = jobWith({ data: { target: "y" } });
    expect(getDataSection(job)).toEqual({ target: "y" });
  });

  it("returns empty objects when sections are absent", () => {
    expect(getEvaluationSection(null)).toEqual({});
    expect(getDataSection(null)).toEqual({});
  });
});

describe("getModelName", () => {
  it("returns model.name", () => {
    expect(getModelName(jobWith({ model: { name: "lgbm" } }))).toBe("lgbm");
  });

  it("returns empty string when missing or non-string", () => {
    expect(getModelName(jobWith({}))).toBe("");
    expect(getModelName(jobWith({ model: { name: 42 } }))).toBe("");
    expect(getModelName(null)).toBe("");
  });
});

describe("getTargetColumn", () => {
  it("returns data.target", () => {
    expect(getTargetColumn(jobWith({ data: { target: "y" } }))).toBe("y");
  });

  it("returns empty string when missing or non-string", () => {
    expect(getTargetColumn(jobWith({}))).toBe("");
    expect(getTargetColumn(jobWith({ data: { target: null } }))).toBe("");
    expect(getTargetColumn(null)).toBe("");
  });
});

describe("defaultRetuneTrials / remainingRetuneTrials", () => {
  it("reads n_trials from config.tuning.optuna.params", () => {
    const job = jobWith({
      tuning: { optuna: { params: { n_trials: 123 } } },
    });
    expect(defaultRetuneTrials(job)).toBe(123);
  });

  it("falls back to 50 when the config is malformed", () => {
    expect(defaultRetuneTrials(jobWith({}))).toBe(50);
    expect(defaultRetuneTrials(jobWith({ tuning: "nope" }))).toBe(50);
    expect(defaultRetuneTrials(jobWith({ tuning: { optuna: "nope" } }))).toBe(
      50,
    );
  });

  it("remaining subtracts completed trial count with a floor of 1", () => {
    const job = {
      ...jobWith({ tuning: { optuna: { params: { n_trials: 10 } } } }),
      tune_result: { trials: [{}, {}, {}] } as unknown,
    } as JobDetail;
    expect(remainingRetuneTrials(job)).toBe(7);
  });

  it("remaining stays at 1 even when all trials finished", () => {
    const job = {
      ...jobWith({ tuning: { optuna: { params: { n_trials: 3 } } } }),
      tune_result: { trials: [{}, {}, {}, {}, {}] } as unknown,
    } as JobDetail;
    expect(remainingRetuneTrials(job)).toBe(1);
  });
});
