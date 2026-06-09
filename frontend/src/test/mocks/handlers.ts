import { HttpResponse, http } from "msw";
import type { components } from "@/api/generated/schema";

// C-6 Phase 5 (H-0080): MSW handlers are typed against the generated
// schema so response shape drift is caught at compile time rather than
// at runtime through test-suite noise. Helper aliases keep the handler
// bodies readable.

type BackendInfo = components["schemas"]["BackendInfoResponse"];
type UiSchema = components["schemas"]["UiSchemaResponse"];
type WorkspaceStatus = components["schemas"]["WorkspaceStatusResponse"];
type TuningSnapshot = components["schemas"]["TuningSnapshotResponse"];

export const handlers = [
  http.get("/api/backends", () =>
    HttpResponse.json<BackendInfo[]>([{ name: "lizyml", version: "0.4.0" }]),
  ),
  http.get("/api/backends/ui-schema", () =>
    HttpResponse.json<UiSchema>({
      sections: [],
      option_sets: {
        objective: {},
        metric: {},
        eval_metric: {},
      },
      parameter_hints: [],
      search_space_catalog: [],
      step_map: {},
      conditional_visibility: {},
      defaults: {},
      inner_valid_options: ["holdout"],
      n_trials_presets: [10, 50, 100],
      capabilities: {
        cv_strategies: ["kfold", "stratified_kfold"],
        tune: { allow_empty_space: true },
      },
      calibration_methods: ["platt", "isotonic", "beta"],
      additional_params: [],
    }),
  ),
  http.get("/api/workspace/status", () =>
    HttpResponse.json<WorkspaceStatus>({
      has_data: false,
      has_config: false,
      has_result: false,
      data_ref: null,
      current_job_id: null,
      files_root: "/tmp",
    }),
  ),
  // Issue #575: TuneTab subscribes to ``useTuningSnapshot`` whenever a task
  // is selected. Without a default handler the request leaks to happy-dom's
  // default ``http://localhost:3000``, causing socket-hang-up noise and an
  // intermittent libuv ``uv__stream_destroy`` worker crash. Empty defaults
  // keep the snapshot semantically inert so individual tests can override
  // with ``server.use(...)`` when they need richer data.
  http.get("/api/workspace/config/tuning-snapshot", () =>
    HttpResponse.json<TuningSnapshot>({
      tuning_effective: {
        n_trials: 0,
        timeout: null,
        direction: "maximize",
        space: {},
        evaluation_metrics: [],
        user_set_paths: [],
      },
      tuning_defaults: {
        space: {},
        evaluation_metrics: [],
        direction: null,
      },
      tuning_overrides: {
        n_trials: null,
        timeout: null,
        direction: null,
        space: {},
        evaluation_metrics: null,
      },
    }),
  ),
];
