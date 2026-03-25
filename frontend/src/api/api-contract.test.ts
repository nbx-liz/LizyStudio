/**
 * API type contract tests — verify hand-written types in types.ts have all
 * required fields and correct shapes, catching drift before the generated
 * schema fully replaces them.
 */
import { describe, expect, it } from "vitest";
import type {
  BackendInfo,
  ColumnInfo,
  ColumnsResponse,
  CompletedMessage,
  ConfigError,
  ConfigUpdateResponse,
  DataRef,
  ErrorMessage,
  FitResult,
  ImportanceResponse,
  JobDetail,
  JobSummary,
  PlotResponse,
  PreviewResponse,
  ProgressMessage,
  SplitSummaryRow,
  TuneResult,
  UiSchema,
  WorkspaceStatus,
  WsMessage,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function assertDefined(value: unknown, label: string) {
  expect(value, `${label} should be defined`).toBeDefined();
}

// ---------------------------------------------------------------------------
// DataRef
// ---------------------------------------------------------------------------
describe("DataRef", () => {
  it("has all required fields", () => {
    const ref: DataRef = {
      source_type: "path",
      path: "/data/train.csv",
      filename: "train.csv",
      fingerprint: "abc123",
      shape: [1000, 20],
    };
    assertDefined(ref.source_type, "source_type");
    assertDefined(ref.path, "path");
    assertDefined(ref.filename, "filename");
    assertDefined(ref.fingerprint, "fingerprint");
    expect(ref.shape).toHaveLength(2);
  });

  it("source_type accepts 'upload'", () => {
    const ref: DataRef = {
      source_type: "upload",
      path: "/tmp/upload.csv",
      filename: "upload.csv",
      fingerprint: "xyz",
      shape: [50, 5],
    };
    expect(ref.source_type).toBe("upload");
  });
});

// ---------------------------------------------------------------------------
// WorkspaceStatus
// ---------------------------------------------------------------------------
describe("WorkspaceStatus", () => {
  it("has all required fields with data loaded", () => {
    const status: WorkspaceStatus = {
      has_data: true,
      has_config: true,
      data_ref: {
        source_type: "path",
        path: "/data/test.csv",
        filename: "test.csv",
        fingerprint: "fp1",
        shape: [100, 10],
      },
      current_job_id: "job-1",
      backend_name: "lizyml",
    };
    expect(status.has_data).toBe(true);
    expect(status.has_config).toBe(true);
    assertDefined(status.data_ref, "data_ref");
    assertDefined(status.current_job_id, "current_job_id");
    assertDefined(status.backend_name, "backend_name");
  });

  it("allows null data_ref and current_job_id", () => {
    const status: WorkspaceStatus = {
      has_data: false,
      has_config: false,
      data_ref: null,
      current_job_id: null,
      backend_name: "lizyml",
    };
    expect(status.data_ref).toBeNull();
    expect(status.current_job_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ColumnInfo + ColumnsResponse
// ---------------------------------------------------------------------------
describe("ColumnsResponse", () => {
  it("has target, suggested_task, and columns array", () => {
    const col: ColumnInfo = {
      name: "age",
      dtype: "int64",
      unique_count: 50,
      suggested_type: "numeric",
      suggested_excluded: false,
      exclude_reason: null,
    };
    const resp: ColumnsResponse = {
      target: "price",
      suggested_task: "regression",
      columns: [col],
    };
    assertDefined(resp.target, "target");
    assertDefined(resp.suggested_task, "suggested_task");
    expect(resp.columns).toHaveLength(1);
    expect(resp.columns[0].name).toBe("age");
  });

  it("ColumnInfo accepts exclude_reason values", () => {
    const idCol: ColumnInfo = {
      name: "id",
      dtype: "int64",
      unique_count: 1000,
      suggested_type: "numeric",
      suggested_excluded: true,
      exclude_reason: "id",
    };
    const constCol: ColumnInfo = {
      name: "flag",
      dtype: "int64",
      unique_count: 1,
      suggested_type: "numeric",
      suggested_excluded: true,
      exclude_reason: "constant",
    };
    expect(idCol.exclude_reason).toBe("id");
    expect(constCol.exclude_reason).toBe("constant");
  });
});

// ---------------------------------------------------------------------------
// PreviewResponse
// ---------------------------------------------------------------------------
describe("PreviewResponse", () => {
  it("has columns and data arrays", () => {
    const resp: PreviewResponse = {
      columns: ["a", "b"],
      data: [{ a: 1, b: "x" }],
    };
    expect(resp.columns).toHaveLength(2);
    expect(resp.data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ConfigUpdateResponse + ConfigError
// ---------------------------------------------------------------------------
describe("ConfigUpdateResponse", () => {
  it("has config and errors", () => {
    const err: ConfigError = { path: "model.name", message: "required" };
    const resp: ConfigUpdateResponse = {
      config: { model: { name: "lgbm" } },
      errors: [err],
    };
    assertDefined(resp.config, "config");
    expect(resp.errors).toHaveLength(1);
    expect(resp.errors[0].path).toBe("model.name");
  });
});

// ---------------------------------------------------------------------------
// BackendInfo
// ---------------------------------------------------------------------------
describe("BackendInfo", () => {
  it("has name and version", () => {
    const info: BackendInfo = { name: "lizyml", version: "0.4.0" };
    expect(info.name).toBe("lizyml");
    expect(info.version).toBe("0.4.0");
  });
});

// ---------------------------------------------------------------------------
// JobSummary
// ---------------------------------------------------------------------------
describe("JobSummary", () => {
  it("has all required fields", () => {
    const job: JobSummary = {
      job_id: "test-job-1",
      job_type: "fit",
      status: "completed",
      backend_name: "lizyml",
      model_name: "lgbm",
      config: { model: { name: "lgbm" } },
      data_ref: {
        source_type: "path",
        path: "/test",
        filename: "test.csv",
        fingerprint: "abc",
        shape: [100, 10],
      },
      created_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:05:00Z",
      error: null,
      error_code: null,
      primary_score: 0.95,
    };
    assertDefined(job.job_id, "job_id");
    assertDefined(job.job_type, "job_type");
    assertDefined(job.status, "status");
    assertDefined(job.backend_name, "backend_name");
    assertDefined(job.config, "config");
    assertDefined(job.data_ref, "data_ref");
    assertDefined(job.created_at, "created_at");
    expect(job.primary_score).toBe(0.95);
  });

  it("accepts all valid status values", () => {
    const statuses: JobSummary["status"][] = [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
    ];
    expect(statuses).toHaveLength(5);
  });

  it("accepts all valid job_type values", () => {
    const types: JobSummary["job_type"][] = ["fit", "tune"];
    expect(types).toHaveLength(2);
  });

  it("allows null for optional fields", () => {
    const job: JobSummary = {
      job_id: "test-job-2",
      job_type: "tune",
      status: "failed",
      backend_name: "lizyml",
      model_name: "",
      config: {},
      data_ref: {
        source_type: "path",
        path: "/test",
        filename: "test.csv",
        fingerprint: "abc",
        shape: [50, 5],
      },
      created_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      error: "Out of memory",
      error_code: "OOM",
      primary_score: null,
    };
    expect(job.completed_at).toBeNull();
    expect(job.primary_score).toBeNull();
    expect(job.error).toBe("Out of memory");
  });
});

// ---------------------------------------------------------------------------
// JobDetail
// ---------------------------------------------------------------------------
describe("JobDetail", () => {
  it("extends JobSummary with result fields", () => {
    const detail: JobDetail = {
      job_id: "job-detail-1",
      job_type: "fit",
      status: "completed",
      backend_name: "lizyml",
      model_name: "lgbm",
      config: {},
      data_ref: {
        source_type: "path",
        path: "/test",
        filename: "test.csv",
        fingerprint: "abc",
        shape: [100, 10],
      },
      created_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:05:00Z",
      error: null,
      error_code: null,
      primary_score: 0.92,
      fit_result: {
        metrics: { auc: 0.92, logloss: 0.3 },
        fold_count: 5,
        params: [{ learning_rate: 0.1 }],
      },
      tune_result: null,
      model_path: "/models/job-detail-1.pkl",
    };
    assertDefined(detail.fit_result, "fit_result");
    expect(detail.tune_result).toBeNull();
    assertDefined(detail.model_path, "model_path");
  });
});

// ---------------------------------------------------------------------------
// FitResult
// ---------------------------------------------------------------------------
describe("FitResult", () => {
  it("has metrics, fold_count, and params", () => {
    const result: FitResult = {
      metrics: { auc: 0.95, logloss: 0.2 },
      fold_count: 5,
      params: [{ learning_rate: 0.1, num_leaves: 31 }],
    };
    expect(result.fold_count).toBe(5);
    expect(result.params).toHaveLength(1);
    expect(result.metrics.auc).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// TuneResult
// ---------------------------------------------------------------------------
describe("TuneResult", () => {
  it("has best_params, best_score, trials, metric_name, direction", () => {
    const result: TuneResult = {
      best_params: { learning_rate: 0.05, num_leaves: 64 },
      best_score: 0.97,
      trials: [
        { trial: 0, value: 0.95, params: { learning_rate: 0.1 } },
        { trial: 1, value: 0.97, params: { learning_rate: 0.05 } },
      ],
      metric_name: "auc",
      direction: "maximize",
    };
    assertDefined(result.best_params, "best_params");
    expect(result.best_score).toBe(0.97);
    expect(result.trials).toHaveLength(2);
    expect(result.metric_name).toBe("auc");
    expect(result.direction).toBe("maximize");
  });
});

// ---------------------------------------------------------------------------
// ImportanceResponse + PlotResponse
// ---------------------------------------------------------------------------
describe("ImportanceResponse", () => {
  it("is a feature->number mapping", () => {
    const resp: ImportanceResponse = { age: 0.4, income: 0.35, zip: 0.25 };
    expect(Object.keys(resp)).toHaveLength(3);
    expect(resp.age).toBe(0.4);
  });
});

describe("PlotResponse", () => {
  it("has plotly_json string", () => {
    const resp: PlotResponse = { plotly_json: '{"data":[],"layout":{}}' };
    expect(typeof resp.plotly_json).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// SplitSummaryRow
// ---------------------------------------------------------------------------
describe("SplitSummaryRow", () => {
  it("has fold and arbitrary metric fields", () => {
    const row: SplitSummaryRow = { fold: 0, auc: 0.92, logloss: 0.3 };
    expect(row.fold).toBe(0);
    expect(row.auc).toBe(0.92);
  });
});

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------
describe("WsMessage", () => {
  it("ProgressMessage has type, current, total", () => {
    const msg: ProgressMessage = {
      type: "progress",
      current: 3,
      total: 5,
      message: "Fold 3/5",
      elapsed: 12.5,
      metrics: { auc: 0.91 },
    };
    expect(msg.type).toBe("progress");
    expect(msg.current).toBe(3);
    expect(msg.total).toBe(5);
  });

  it("CompletedMessage has type and job_id", () => {
    const msg: CompletedMessage = { type: "completed", job_id: "job-1" };
    expect(msg.type).toBe("completed");
    assertDefined(msg.job_id, "job_id");
  });

  it("ErrorMessage has type and message", () => {
    const msg: ErrorMessage = { type: "error", message: "Something failed" };
    expect(msg.type).toBe("error");
    assertDefined(msg.message, "message");
  });

  it("WsMessage union covers all three types", () => {
    const messages: WsMessage[] = [
      { type: "progress", current: 1, total: 5 },
      { type: "completed", job_id: "j1" },
      { type: "error", message: "fail" },
    ];
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.type)).toEqual([
      "progress",
      "completed",
      "error",
    ]);
  });
});

// ---------------------------------------------------------------------------
// UiSchema
// ---------------------------------------------------------------------------
describe("UiSchema", () => {
  it("has all required top-level fields", () => {
    const schema: UiSchema = {
      sections: [{ key: "model", title: "Model" }],
      option_sets: { objective: { binary: ["binary:logistic"] } },
      parameter_hints: [
        { key: "learning_rate", label: "Learning Rate", kind: "float" },
      ],
      search_space_catalog: [
        {
          key: "learning_rate",
          title: "Learning Rate",
          paramType: "float",
          modes: ["fixed", "range"],
        },
      ],
      step_map: { learning_rate: 0.01 },
      conditional_visibility: {},
      defaults: { model: { name: "lgbm" } },
      inner_valid_options: ["holdout"],
    };
    assertDefined(schema.sections, "sections");
    assertDefined(schema.option_sets, "option_sets");
    assertDefined(schema.parameter_hints, "parameter_hints");
    assertDefined(schema.search_space_catalog, "search_space_catalog");
    assertDefined(schema.step_map, "step_map");
    assertDefined(schema.conditional_visibility, "conditional_visibility");
    assertDefined(schema.defaults, "defaults");
    assertDefined(schema.inner_valid_options, "inner_valid_options");
  });

  it("accepts optional capability fields", () => {
    const schema: UiSchema = {
      sections: [],
      option_sets: {},
      parameter_hints: [],
      search_space_catalog: [],
      step_map: {},
      conditional_visibility: {},
      defaults: {},
      inner_valid_options: [],
      capabilities: {
        cv_strategies: ["kfold", "stratified_kfold"],
        tune: { allow_empty_space: true },
      },
      calibration_methods: ["platt", "isotonic"],
      additional_params: ["feature_pre_filter"],
      n_trials_presets: [10, 50, 100],
    };
    expect(schema.capabilities?.cv_strategies).toHaveLength(2);
    expect(schema.calibration_methods).toHaveLength(2);
    expect(schema.n_trials_presets).toEqual([10, 50, 100]);
  });
});
