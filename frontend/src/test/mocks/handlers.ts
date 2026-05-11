import { HttpResponse, http } from "msw";
import type { components } from "@/api/generated/schema";

// C-6 Phase 5 (H-0080): MSW handlers are typed against the generated
// schema so response shape drift is caught at compile time rather than
// at runtime through test-suite noise. Helper aliases keep the handler
// bodies readable.

type BackendInfo = components["schemas"]["BackendInfoResponse"];
type UiSchema = components["schemas"]["UiSchemaResponse"];
type WorkspaceStatus = components["schemas"]["WorkspaceStatusResponse"];

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
];
