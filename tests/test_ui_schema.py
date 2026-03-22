"""Tests for BackendAdapter.get_ui_schema() and GET /api/backends/ui-schema (H-0026)."""

from __future__ import annotations

import sys

from fastapi.testclient import TestClient

from lizystudio.backends.lizyml import LizyMLAdapter

UI_SCHEMA_KEYS = {
    "sections",
    "option_sets",
    "metric_direction",
    "parameter_hints",
    "search_space_catalog",
    "step_map",
    "conditional_visibility",
    "defaults",
    "inner_valid_options",
    "n_trials_presets",
    "capabilities",
    "calibration_methods",
    "additional_params",
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
        assert isinstance(step_map["learning_rate"], int | float)

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
        md = schema["metric_direction"]
        assert isinstance(md, dict)
        for task in ("binary", "regression", "multiclass"):
            assert task in md

    def test_metric_direction_values_are_minimize_or_maximize(self) -> None:
        schema = LizyMLAdapter().get_ui_schema()
        md = schema["metric_direction"]
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

    def test_cached_metrics_return_same_result(self) -> None:
        """get_eval_metrics_by_task returns cached result on repeated calls."""
        from lizystudio.backends.lizyml_ui_schema import get_eval_metrics_by_task

        r1 = get_eval_metrics_by_task()
        r2 = get_eval_metrics_by_task()
        assert r1 is r2  # same object reference (cached)

    def test_cached_metric_directions_return_same_result(self) -> None:
        """get_metric_directions returns cached result on repeated calls."""
        from lizystudio.backends.lizyml_ui_schema import get_metric_directions

        r1 = get_metric_directions()
        r2 = get_metric_directions()
        assert r1 is r2  # same object reference (cached)

    def test_model_metric_options_structure(self) -> None:
        """model_metric should have task-keyed lists of metric strings."""
        schema = LizyMLAdapter().get_ui_schema()
        model_metric = schema["option_sets"]["model_metric"]
        for task in ("binary", "regression", "multiclass"):
            assert task in model_metric
            assert isinstance(model_metric[task], list)
            assert len(model_metric[task]) > 0
            for m in model_metric[task]:
                assert isinstance(m, str)

    def test_conditional_visibility_num_leaves(self) -> None:
        """conditional_visibility should have num_leaves/num_leaves_ratio entries."""
        schema = LizyMLAdapter().get_ui_schema()
        vis = schema["conditional_visibility"]
        assert "num_leaves" in vis
        assert "num_leaves_ratio" in vis
        assert vis["num_leaves"]["auto_num_leaves"] is False
        assert vis["num_leaves_ratio"]["auto_num_leaves"] is True

    def test_capabilities_cv_strategies(self) -> None:
        """capabilities.cv_strategies must list all 8 supported CV strategy names."""
        schema = LizyMLAdapter().get_ui_schema()
        assert "capabilities" in schema
        cv = schema["capabilities"]["cv_strategies"]
        assert isinstance(cv, list)
        assert len(cv) == 8
        expected = {
            "kfold",
            "stratified_kfold",
            "group_kfold",
            "stratified_group_kfold",
            "time_series",
            "purged_time_series",
            "group_time_series",
            "blocked_group_kfold",
        }
        assert set(cv) == expected

    def test_capabilities_tune_allow_empty_space(self) -> None:
        """capabilities.tune.allow_empty_space must be True."""
        schema = LizyMLAdapter().get_ui_schema()
        assert schema["capabilities"]["tune"]["allow_empty_space"] is True

    def test_calibration_methods(self) -> None:
        """calibration_methods must be exactly ['platt', 'isotonic', 'beta']."""
        schema = LizyMLAdapter().get_ui_schema()
        assert schema["calibration_methods"] == ["platt", "isotonic", "beta"]

    def test_additional_params_is_list(self) -> None:
        """additional_params is a non-empty str list."""
        schema = LizyMLAdapter().get_ui_schema()
        additional = schema["additional_params"]
        assert isinstance(additional, list)
        assert len(additional) > 0
        hint_keys = {h["key"] for h in schema["parameter_hints"]}
        for param in additional:
            assert isinstance(param, str)
            assert param not in hint_keys

    def test_search_space_catalog_has_group(self) -> None:
        """Each catalog entry has a valid 'group' key."""
        schema = LizyMLAdapter().get_ui_schema()
        allowed_groups = {"model_params", "smart_params", "training"}
        for entry in schema["search_space_catalog"]:
            assert "group" in entry, f"Missing 'group' on catalog entry: {entry['key']}"
            assert (
                entry["group"] in allowed_groups
            ), f"Invalid group '{entry['group']}' on entry '{entry['key']}'"

    def test_conditional_visibility_early_stopping(self) -> None:
        """conditional_visibility must include all three early_stopping sub-keys."""
        schema = LizyMLAdapter().get_ui_schema()
        vis = schema["conditional_visibility"]
        for key in (
            "early_stopping.rounds",
            "validation_ratio",
            "inner_valid",
        ):
            assert key in vis, f"Missing conditional_visibility key: {key}"


def _reset_ui_schema_caches() -> None:
    """Reset module-level caches to force re-evaluation."""
    import lizystudio.backends.lizyml_ui_schema as m

    m._eval_metrics_cache = None
    m._metric_direction_cache = None


class TestUiSchemaFallbacks:
    def test_get_eval_metrics_fallback_when_import_fails(
        self, monkeypatch: object
    ) -> None:
        """Lines 32-34: ImportError fallback in get_eval_metrics_by_task."""
        import lizystudio.backends.lizyml_ui_schema as m

        _reset_ui_schema_caches()
        monkeypatch.setitem(sys.modules, "lizyml.metrics.registry", None)  # type: ignore[attr-defined]
        try:
            result = m.get_eval_metrics_by_task()
            assert "binary" in result
            assert "regression" in result
            assert "multiclass" in result
        finally:
            _reset_ui_schema_caches()

    def test_get_metric_directions_fallback_when_import_fails(
        self, monkeypatch: object
    ) -> None:
        """Lines 88-92: ImportError fallback in get_metric_directions."""
        import lizystudio.backends.lizyml_ui_schema as m

        _reset_ui_schema_caches()
        monkeypatch.setitem(sys.modules, "lizyml.metrics.registry", None)  # type: ignore[attr-defined]
        try:
            result = m.get_metric_directions()
            for task_dirs in result.values():
                for direction in task_dirs.values():
                    assert direction in ("minimize", "maximize")
        finally:
            _reset_ui_schema_caches()

    def test_inner_lock_guard_returns_cached_value(self) -> None:
        """Lines 26 and 71: inner double-check returns same cached object."""
        import lizystudio.backends.lizyml_ui_schema as m

        r1 = m.get_eval_metrics_by_task()
        r2 = m.get_eval_metrics_by_task()
        assert r1 is r2
        d1 = m.get_metric_directions()
        d2 = m.get_metric_directions()
        assert d1 is d2


# --- Integration test: API endpoint ---


class TestUiSchemaEndpoint:
    def test_get_ui_schema_returns_200(self, client: TestClient) -> None:
        resp = client.get("/api/backends/ui-schema")
        assert resp.status_code == 200

    def test_get_ui_schema_has_all_keys(self, client: TestClient) -> None:
        resp = client.get("/api/backends/ui-schema")
        data = resp.json()
        assert set(data.keys()) == UI_SCHEMA_KEYS

    def test_get_ui_schema_parameter_hints_non_empty(self, client: TestClient) -> None:
        resp = client.get("/api/backends/ui-schema")
        hints = resp.json()["parameter_hints"]
        assert isinstance(hints, list)
        assert len(hints) > 0

    def test_get_ui_schema_option_sets_has_tasks(self, client: TestClient) -> None:
        resp = client.get("/api/backends/ui-schema")
        metric = resp.json()["option_sets"]["metric"]
        assert "binary" in metric
        assert "regression" in metric
