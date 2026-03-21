import { HttpResponse, http } from "msw";

export const handlers = [
  http.get("/api/backends", () => {
    return HttpResponse.json([{ name: "lizyml", version: "0.4.0" }]);
  }),
  http.get("/api/backends/ui-schema", () => {
    return HttpResponse.json({
      sections: [],
      option_sets: {
        objective: {},
        metric: {},
        model_metric: {},
        metric_direction: {},
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
    });
  }),
  http.get("/api/workspace/status", () => {
    return HttpResponse.json({
      has_data: false,
      has_config: false,
      data_ref: null,
      current_job_id: null,
    });
  }),
];
