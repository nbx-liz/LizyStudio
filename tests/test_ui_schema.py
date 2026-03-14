"""Tests for BackendAdapter.get_ui_schema() and GET /api/backends/ui-schema (H-0026)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from lizystudio.backends.lizyml import LizyMLAdapter

UI_SCHEMA_KEYS = {
    "sections",
    "option_sets",
    "parameter_hints",
    "search_space_catalog",
    "step_map",
    "conditional_visibility",
    "defaults",
    "inner_valid_options",
    "n_trials_presets",
}


# --- Unit tests: LizyMLAdapter.get_ui_schema() ---


class TestLizyMLAdapterUiSchema:
    def test_returns_dict_with_all_top_level_keys(self) -> None:
        adapter = LizyMLAdapter()
        schema = adapter.get_ui_schema()
        assert isinstance(schema, dict)
        assert set(schema.keys()) == UI_SCHEMA_KEYS

    def test_sections_is_list_of_dicts(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        sections = schema["sections"]
        assert isinstance(sections, list)
        assert len(sections) >= 3
        for s in sections:
            assert "key" in s
            assert "title" in s

    def test_parameter_hints_structure(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        hints = schema["parameter_hints"]
        assert isinstance(hints, list)
        assert len(hints) >= 5
        for h in hints:
            assert "key" in h
            assert "label" in h
            assert "kind" in h

    def test_parameter_hints_include_learning_rate(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        keys = [h["key"] for h in schema["parameter_hints"]]
        assert "learning_rate" in keys

    def test_option_sets_has_required_keys(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        option_sets = schema["option_sets"]
        assert "objective" in option_sets
        assert "metric" in option_sets
        assert "model_metric" in option_sets

    def test_option_sets_metric_has_all_tasks(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        metric = schema["option_sets"]["metric"]
        for task in ("binary", "regression", "multiclass"):
            assert task in metric
            assert isinstance(metric[task], list)
            assert len(metric[task]) > 0

    def test_option_sets_objective_has_all_tasks(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        objective = schema["option_sets"]["objective"]
        assert "binary" in objective
        assert "regression" in objective
        assert "multiclass" in objective

    def test_search_space_catalog_structure(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        catalog = schema["search_space_catalog"]
        assert isinstance(catalog, list)
        assert len(catalog) >= 5
        for entry in catalog:
            assert "key" in entry
            assert "title" in entry
            assert "paramType" in entry
            assert "modes" in entry
            assert isinstance(entry["modes"], list)

    def test_step_map_is_dict_of_numbers(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        step_map = schema["step_map"]
        assert isinstance(step_map, dict)
        assert "learning_rate" in step_map
        assert isinstance(step_map["learning_rate"], (int, float))

    def test_conditional_visibility_calibration(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        vis = schema["conditional_visibility"]
        assert "calibration" in vis
        assert vis["calibration"]["task"] == ["binary"]

    def test_defaults_calibration(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        defaults = schema["defaults"]
        assert "calibration" in defaults
        cal = defaults["calibration"]
        assert "method" in cal
        assert "n_splits" in cal

    def test_inner_valid_options(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        opts = schema["inner_valid_options"]
        assert isinstance(opts, list)
        assert "holdout" in opts

    def test_metric_direction_has_all_tasks(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        md = schema["option_sets"]["metric_direction"]
        assert isinstance(md, dict)
        for task in ("binary", "regression", "multiclass"):
            assert task in md

    def test_metric_direction_values_are_minimize_or_maximize(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        md = schema["option_sets"]["metric_direction"]
        for task_metrics in md.values():
            for direction in task_metrics.values():
                assert direction in ("minimize", "maximize")

    def test_search_space_catalog_includes_auto_num_leaves(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        keys = [e["key"] for e in schema["search_space_catalog"]]
        assert "auto_num_leaves" in keys
        assert "num_leaves_ratio" in keys
        assert "min_data_in_leaf_ratio" in keys
        assert "min_data_in_bin_ratio" in keys

    def test_n_trials_presets(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        presets = schema.get("n_trials_presets")
        assert presets == [10, 50, 100, 200, 500]

    def test_idempotent_multiple_calls(self) -> None:
        """Cached result should be identical across calls."""
        adapter = LizyMLAdapter()
        s1 = adapter.get_ui_schema()
        s2 = adapter.get_ui_schema()
        assert s1 == s2


# --- Integration test: API endpoint ---


class TestUiSchemaEndpoint:
    def test_get_ui_schema_returns_200(self, client: TestClient) -> None:
        resp = client.get("/api/backends/ui-schema")
        assert resp.status_code == 200

    def test_get_ui_schema_has_all_keys(self, client: TestClient) -> None:
        resp = client.get("/api/backends/ui-schema")
        data = resp.json()
        assert set(data.keys()) == UI_SCHEMA_KEYS

    def test_get_ui_schema_parameter_hints_non_empty(
        self, client: TestClient
    ) -> None:
        resp = client.get("/api/backends/ui-schema")
        hints = resp.json()["parameter_hints"]
        assert isinstance(hints, list)
        assert len(hints) > 0

    def test_get_ui_schema_option_sets_has_tasks(
        self, client: TestClient
    ) -> None:
        resp = client.get("/api/backends/ui-schema")
        metric = resp.json()["option_sets"]["metric"]
        assert "binary" in metric
        assert "regression" in metric
