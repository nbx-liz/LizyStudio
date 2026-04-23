"""Tests for BackendAdapter.get_ui_schema() and GET /api/backends/ui-schema (H-0026)."""

from __future__ import annotations

import sys

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.lizyml import LizyMLAdapter

pytestmark = pytest.mark.integration

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
    "special_search_space_fields",
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
        allowed_groups = {"model_params", "smart_params", "training", "additional"}
        for entry in schema["search_space_catalog"]:
            assert "group" in entry, f"Missing 'group' on catalog entry: {entry['key']}"
            assert entry["group"] in allowed_groups, (
                f"Invalid group '{entry['group']}' on entry '{entry['key']}'"
            )

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

    # --- Default value tests (TDD: RED first) ---

    def test_all_parameter_hints_have_default_field(self) -> None:
        """Every parameter_hint entry must expose a 'default' field."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = schema["parameter_hints"]
        for h in hints:
            assert "default" in h, (
                f"parameter_hint '{h['key']}' is missing a 'default' field"
            )

    def test_parameter_hint_n_estimators_default(self) -> None:
        """n_estimators default must be 1500."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["n_estimators"]["default"] == 1500

    def test_parameter_hint_learning_rate_default(self) -> None:
        """learning_rate default must be 0.001."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["learning_rate"]["default"] == 0.001

    def test_parameter_hint_max_depth_default(self) -> None:
        """max_depth default must be 5."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["max_depth"]["default"] == 5

    def test_parameter_hint_max_bin_default(self) -> None:
        """max_bin default must be 511."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["max_bin"]["default"] == 511

    def test_parameter_hint_feature_fraction_default(self) -> None:
        """feature_fraction default must be 0.7."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["feature_fraction"]["default"] == 0.7

    def test_parameter_hint_bagging_fraction_default(self) -> None:
        """bagging_fraction default must be 0.7."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["bagging_fraction"]["default"] == 0.7

    def test_parameter_hint_bagging_freq_default(self) -> None:
        """bagging_freq default must be 10."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["bagging_freq"]["default"] == 10

    def test_parameter_hint_lambda_l1_default(self) -> None:
        """lambda_l1 default must be 0.0."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["lambda_l1"]["default"] == 0.0

    def test_parameter_hint_lambda_l2_default(self) -> None:
        """lambda_l2 default must be 0.000001."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["lambda_l2"]["default"] == 0.000001

    def test_parameter_hint_first_metric_only_default(self) -> None:
        """first_metric_only default must be False."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["first_metric_only"]["default"] is False

    def test_parameter_hint_balanced_default(self) -> None:
        """balanced default must be True."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert hints["balanced"]["default"] is True

    def test_search_space_catalog_seed_default(self) -> None:
        """search_space_catalog seed default must be 1120."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        assert catalog["seed"]["default"] == 1120

    def test_parameter_hint_objective_default_is_task_keyed_dict(self) -> None:
        """objective default must be a dict with regression/binary/multiclass keys."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        default = hints["objective"]["default"]
        assert isinstance(default, dict), "objective default must be a dict"
        for task in ("regression", "binary", "multiclass"):
            assert task in default, f"objective default missing task key: {task}"
        assert default["regression"] == "huber"
        assert default["binary"] == "binary"
        assert default["multiclass"] == "multiclass"

    def test_parameter_hint_metric_default_is_task_keyed_dict(self) -> None:
        """metric default must be a task-keyed dict of arrays."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        default = hints["metric"]["default"]
        assert isinstance(default, dict), "metric default must be a dict"
        for task in ("regression", "binary", "multiclass"):
            assert task in default, f"metric default missing task key: {task}"
        assert default["regression"] == ["huber", "mae", "mape"]
        assert default["binary"] == ["auc", "binary_logloss"]
        assert default["multiclass"] == ["auc_mu", "multi_logloss"]

    def test_search_space_catalog_model_params_have_default(self) -> None:
        """All model_params catalog entries must have a 'default' field."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = schema["search_space_catalog"]
        model_params = [e for e in catalog if e.get("group") == "model_params"]
        for entry in model_params:
            assert "default" in entry, (
                f"search_space_catalog model_params entry '{entry['key']}' "
                "is missing a 'default' field"
            )

    def test_search_space_catalog_smart_params_have_default(self) -> None:
        """All smart_params catalog entries must have a 'default' field."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = schema["search_space_catalog"]
        smart_params = [e for e in catalog if e.get("group") == "smart_params"]
        for entry in smart_params:
            assert "default" in entry, (
                f"search_space_catalog smart_params entry '{entry['key']}' "
                "is missing a 'default' field"
            )

    def test_search_space_catalog_n_estimators_default(self) -> None:
        """search_space_catalog n_estimators default must be 1500."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        assert catalog["n_estimators"]["default"] == 1500

    def test_search_space_catalog_auto_num_leaves_default(self) -> None:
        """search_space_catalog auto_num_leaves default must be True."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        assert catalog["auto_num_leaves"]["default"] is True

    def test_eval_metrics_match_lizyml_registry(self) -> None:
        """option_sets.metric must match the live LizyML _TASK_METRICS registry."""
        from lizyml.metrics.registry import _TASK_METRICS

        schema = LizyMLAdapter().get_ui_schema()
        for task in ("binary", "regression", "multiclass"):
            expected = sorted(_TASK_METRICS[task])
            actual = sorted(schema["option_sets"]["metric"][task])
            assert actual == expected, (
                f"metric mismatch for {task}: expected={expected}, actual={actual}"
            )

    def test_model_metric_includes_feval_metrics(self) -> None:
        """model_metric for binary should include feval metrics from v0.6.0+."""
        schema = LizyMLAdapter().get_ui_schema()
        binary_mm = schema["option_sets"]["model_metric"]["binary"]
        # These became available as training metrics via metric bridge
        for m in ("f1", "accuracy", "brier", "ece", "precision_at_k"):
            assert m in binary_mm, f"binary model_metric missing feval metric: {m}"

    def test_model_metric_multiclass_uses_lizyml_names(self) -> None:
        """model_metric for multiclass should use LightGBM native metric names."""
        schema = LizyMLAdapter().get_ui_schema()
        mc_mm = schema["option_sets"]["model_metric"]["multiclass"]
        assert "multi_logloss" in mc_mm
        assert "multi_error" in mc_mm
        assert "auc_mu" in mc_mm

    # --- Phase 1: Expanded parameter coverage (Widget parity) ---

    def test_parameter_hints_include_balanced(self) -> None:
        """balanced must be in parameter_hints as a boolean kind."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert "balanced" in hints
        assert hints["balanced"]["kind"] == "boolean"

    def test_parameter_hints_include_num_leaves(self) -> None:
        """num_leaves must be in parameter_hints as an integer kind."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert "num_leaves" in hints
        assert hints["num_leaves"]["kind"] == "integer"

    def test_parameter_hints_include_verbose(self) -> None:
        """verbose must be in parameter_hints as an integer kind."""
        schema = LizyMLAdapter().get_ui_schema()
        hints = {h["key"]: h for h in schema["parameter_hints"]}
        assert "verbose" in hints
        assert hints["verbose"]["kind"] == "integer"

    def test_search_space_catalog_includes_balanced(self) -> None:
        """balanced must be in search_space_catalog (smart_params group)."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        assert "balanced" in catalog
        assert catalog["balanced"]["group"] == "smart_params"
        assert catalog["balanced"]["paramType"] == "boolean"

    def test_search_space_catalog_includes_feature_weights(self) -> None:
        """feature_weights must be in search_space_catalog (smart_params group)."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        assert "feature_weights" in catalog
        assert catalog["feature_weights"]["group"] == "smart_params"
        assert catalog["feature_weights"]["paramType"] == "object"

    def test_search_space_catalog_includes_num_leaves(self) -> None:
        """num_leaves must be in search_space_catalog with range+choice modes."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        assert "num_leaves" in catalog
        assert catalog["num_leaves"]["group"] == "smart_params"
        assert "range" in catalog["num_leaves"]["modes"]

    def test_search_space_catalog_includes_verbose(self) -> None:
        """verbose must be in search_space_catalog (model_params group)."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        assert "verbose" in catalog
        assert catalog["verbose"]["group"] == "model_params"

    def test_additional_params_expanded(self) -> None:
        """additional_params should include Widget-level LGBM params not in catalog."""
        schema = LizyMLAdapter().get_ui_schema()
        additional = set(schema["additional_params"])
        # These should be in additional_params (not promoted to catalog)
        # min_gain_to_split excluded: alias for min_split_gain (in catalog)
        # is_unbalance excluded: use `balanced` smart param instead
        expected_subset = {
            "min_child_samples",
            "min_data_in_leaf",
            "min_data_in_bin",
            "max_cat_to_onehot",
            "top_k",
            "min_sum_hessian_in_leaf",
            "linear_tree",
            "feature_pre_filter",
            "force_col_wise",
            "force_row_wise",
            "histogram_pool_size",
            "sigmoid",
            "boost_from_average",
            "bin_construct_sample_cnt",
            "data_sample_strategy",
            "interaction_constraints",
        }
        missing = expected_subset - additional
        assert not missing, f"additional_params missing: {missing}"

    def test_additional_params_not_in_hints_or_catalog(self) -> None:
        """additional_params must not overlap with parameter_hints or catalog keys."""
        schema = LizyMLAdapter().get_ui_schema()
        hint_keys = {h["key"] for h in schema["parameter_hints"]}
        catalog_keys = {e["key"] for e in schema["search_space_catalog"]}
        known_keys = hint_keys | catalog_keys
        for param in schema["additional_params"]:
            assert param not in known_keys, (
                f"additional_param '{param}' overlaps with hints/catalog"
            )

    def test_additional_params_include_tunable_extras(self) -> None:
        """additional_params list includes commonly tuned params (Widget conformance).

        These are available via the '+ Add' dropdown, not as catalog entries.
        """
        schema = LizyMLAdapter().get_ui_schema()
        additional = schema["additional_params"]
        for key in ("min_child_weight", "min_gain_to_split", "scale_pos_weight"):
            assert key in additional, f"additional_params missing: {key}"

    def test_model_metric_regression_includes_lgbm_native(self) -> None:
        """model_metric regression should include LightGBM native metrics."""
        schema = LizyMLAdapter().get_ui_schema()
        reg_mm = schema["option_sets"]["model_metric"]["regression"]
        for m in ("l1", "l2", "rmse", "huber", "mape", "quantile"):
            assert m in reg_mm, f"regression model_metric missing LGB native: {m}"

    def test_model_metric_binary_includes_lgbm_native(self) -> None:
        """model_metric binary should include LightGBM native metrics."""
        schema = LizyMLAdapter().get_ui_schema()
        binary_mm = schema["option_sets"]["model_metric"]["binary"]
        for m in ("binary_logloss", "binary_error", "average_precision", "auc"):
            assert m in binary_mm, f"binary model_metric missing LGB native: {m}"

    def test_model_metric_multiclass_includes_lgbm_native(self) -> None:
        """model_metric multiclass should include LightGBM native metrics."""
        schema = LizyMLAdapter().get_ui_schema()
        mc_mm = schema["option_sets"]["model_metric"]["multiclass"]
        for m in ("multi_logloss", "multi_error", "auc_mu"):
            assert m in mc_mm, f"multiclass model_metric missing LGB native: {m}"

    def test_capabilities_cv_strategy_fields(self) -> None:
        """capabilities must include cv_strategy_fields mapping."""
        schema = LizyMLAdapter().get_ui_schema()
        caps = schema["capabilities"]
        assert "cv_strategy_fields" in caps
        fields = caps["cv_strategy_fields"]
        assert isinstance(fields, dict)
        # All 8 strategies must have field lists
        for strategy in caps["cv_strategies"]:
            assert strategy in fields, f"cv_strategy_fields missing: {strategy}"
            assert isinstance(fields[strategy], list)

    def test_capabilities_cv_strategy_fields_ui_semantics(self) -> None:
        """H-0076 (C-5b Part 2): ``cv_strategy_fields`` is the SSOT for UI
        conditional-field rendering. Every strategy enumerates **all**
        UI-visible inputs — generic (``n_splits``, ``random_state``,
        ``shuffle``) plus strategy-specific (``time_col``, ``group_col``,
        ``gap``, ``purge_gap``, ``embargo``, ``train_size_max``,
        ``test_size_max``, ``min_train_rows``, ``min_valid_rows``).

        Wire-format keys (``max_train_size`` etc.) must NOT leak into
        this list — the frontend renders UI using these names and writes
        the same names into ``split`` / ``data``, so they need to match
        the LizyConfig schema field names (which use ``train_size_max``).
        """
        schema = LizyMLAdapter().get_ui_schema()
        fields = schema["capabilities"]["cv_strategy_fields"]

        # Expected fields per strategy — SSOT for the frontend UI map.
        # Issue #258 / #259: these lists must match the matching
        # Pydantic variant (or DataConfig for target/time_col/
        # group_col). The contract test
        # ``tests/contract/test_ui_schema_matches_pydantic.py`` locks
        # this invariant and is the source of truth.
        expected = {
            "kfold": ["n_splits", "random_state", "shuffle"],
            "stratified_kfold": ["n_splits", "random_state"],
            "group_kfold": ["n_splits", "group_col"],
            "stratified_group_kfold": [
                "n_splits",
                "random_state",
                "shuffle",
                "group_col",
            ],
            "time_series": [
                "n_splits",
                "time_col",
                "gap",
                "train_size_max",
                "test_size_max",
            ],
            "purged_time_series": [
                "n_splits",
                "time_col",
                "purge_gap",
                "embargo",
                "train_size_max",
                "test_size_max",
            ],
            "group_time_series": [
                "n_splits",
                "time_col",
                "group_col",
                "gap",
                "train_size_max",
                "test_size_max",
            ],
            "blocked_group_kfold": [
                "time_col",
                "group_col",
                "min_train_rows",
                "min_valid_rows",
            ],
        }
        for strategy, expected_fields in expected.items():
            assert fields[strategy] == expected_fields, (
                f"cv_strategy_fields[{strategy}] mismatch: "
                f"got {fields[strategy]}, want {expected_fields}"
            )

        # Wire-format keys must not appear in cv_strategy_fields.
        for strategy, strategy_fields in fields.items():
            for wire_key in ("max_train_size", "max_test_size", "folds"):
                assert wire_key not in strategy_fields, (
                    f"cv_strategy_fields[{strategy}] should use UI/LizyConfig "
                    f"names, not wire-format key {wire_key!r}"
                )

    def test_capabilities_cv_defaults(self) -> None:
        """capabilities must include cv_defaults with n_splits."""
        schema = LizyMLAdapter().get_ui_schema()
        caps = schema["capabilities"]
        assert "cv_defaults" in caps
        defaults = caps["cv_defaults"]
        assert "n_splits" in defaults
        assert defaults["n_splits"] == 5

    def test_capabilities_cv_default_strategy(self) -> None:
        """capabilities must include cv_default_strategy per task."""
        schema = LizyMLAdapter().get_ui_schema()
        caps = schema["capabilities"]
        assert "cv_default_strategy" in caps
        ds = caps["cv_default_strategy"]
        assert ds["binary"] == "stratified_kfold"
        assert ds["regression"] == "kfold"
        assert ds["multiclass"] == "stratified_kfold"

    def test_special_search_space_fields(self) -> None:
        """special_search_space_fields maps keys to picker types."""
        schema = LizyMLAdapter().get_ui_schema()
        assert "special_search_space_fields" in schema
        ssf = schema["special_search_space_fields"]
        assert ssf["objective"] == "objective"
        assert ssf["metric"] == "model_metric"

    def test_search_space_catalog_learning_rate_default_mode_range(self) -> None:
        """learning_rate must have default_mode='range' and default_range (H-0053)."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        lr = catalog["learning_rate"]
        assert lr["default_mode"] == "range"
        assert lr["default_range"] == {"low": 0.0001, "high": 0.1, "log": True}

    def test_search_space_catalog_num_leaves_no_default_range(self) -> None:
        """num_leaves must NOT have default_mode/default_range (Widget conformance).

        num_leaves visibility is controlled by auto_num_leaves conditional_visibility.
        """
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        nl = catalog["num_leaves"]
        assert "default_mode" not in nl
        assert "default_range" not in nl

    def test_search_space_catalog_n_estimators_default_mode_range(self) -> None:
        """n_estimators must have default_mode='range' and default_range (H-0053)."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        ne = catalog["n_estimators"]
        assert ne["default_mode"] == "range"
        assert ne["default_range"] == {"low": 600, "high": 2500, "log": False}

    def test_search_space_catalog_max_depth_default_mode_range(self) -> None:
        """max_depth must have default_mode='range' and default_range (H-0053)."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        md = catalog["max_depth"]
        assert md["default_mode"] == "range"
        assert md["default_range"] == {"low": 3, "high": 12, "log": False}

    def test_search_space_catalog_max_bin_uses_choice_mode(self) -> None:
        """max_bin uses default_mode=choice with default_choices."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        assert catalog["max_bin"]["default_mode"] == "choice"
        assert catalog["max_bin"]["default_choices"] == [
            15,
            63,
            127,
            255,
            511,
            1023,
        ]
        assert "default_range" not in catalog["max_bin"]

    def test_search_space_catalog_default_range_low_lt_high(self) -> None:
        """All default_range entries must have low < high (H-0053)."""
        schema = LizyMLAdapter().get_ui_schema()
        for entry in schema["search_space_catalog"]:
            dr = entry.get("default_range")
            if dr is not None:
                assert dr["low"] < dr["high"], (
                    f"default_range low >= high for '{entry['key']}': {dr}"
                )

    def test_step_map_includes_expanded_params(self) -> None:
        """step_map should include entries for newly added params."""
        schema = LizyMLAdapter().get_ui_schema()
        step_map = schema["step_map"]
        for key in (
            "min_child_weight",
            "min_split_gain",
            "scale_pos_weight",
        ):
            assert key in step_map, f"step_map missing: {key}"

    # --- Widget-conformance tests ---

    def test_eval_metrics_preferred_first(self) -> None:
        """Eval metrics must place preferred metric first (Widget conformance).

        binary: auc first, regression: rmse first, multiclass: auc first.
        """
        schema = LizyMLAdapter().get_ui_schema()
        metrics = schema["option_sets"]["metric"]
        assert metrics["binary"][0] == "auc", f"binary first: {metrics['binary'][0]}"
        assert metrics["regression"][0] == "rmse", (
            f"regression first: {metrics['regression'][0]}"
        )
        assert metrics["multiclass"][0] == "auc", (
            f"multiclass first: {metrics['multiclass'][0]}"
        )

    def test_search_space_catalog_ordering_smart_first(self) -> None:
        """search_space_catalog: Smart Params before Model Params."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = schema["search_space_catalog"]
        groups_in_order = []
        for entry in catalog:
            g = entry.get("group", "model_params")
            if not groups_in_order or groups_in_order[-1] != g:
                groups_in_order.append(g)
        assert groups_in_order[0] == "smart_params", (
            f"First group should be smart_params, got: {groups_in_order}"
        )
        assert "model_params" in groups_in_order
        # smart_params must appear before model_params
        sp_idx = groups_in_order.index("smart_params")
        mp_idx = groups_in_order.index("model_params")
        assert sp_idx < mp_idx, (
            f"smart_params (idx={sp_idx}) must come before model_params (idx={mp_idx})"
        )

    def test_num_leaves_modes_no_choice(self) -> None:
        """num_leaves: fixed+range only (no choice)."""
        schema = LizyMLAdapter().get_ui_schema()
        catalog = {e["key"]: e for e in schema["search_space_catalog"]}
        nl = catalog["num_leaves"]
        assert nl["modes"] == ["fixed", "range"], f"num_leaves modes: {nl['modes']}"


def _reset_ui_schema_caches() -> None:
    """Reset module-level caches to force re-evaluation."""
    import lizystudio.backends.lizyml_metrics as metrics

    metrics._eval_metrics_cache = None
    metrics._metric_direction_cache = None


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

    def test_get_eval_metrics_inner_double_check_returns_cached(self) -> None:
        """Line 112: inner if-check inside lock returns pre-populated cache.

        Simulate the race condition where cache is populated between the outer
        check and acquiring the lock.  We pre-populate the cache while holding
        no lock, then call get_eval_metrics_by_task again — the inner check
        (line 112) must short-circuit and return the cached object.
        """
        import lizystudio.backends.lizyml_ui_schema as m

        # First call populates the cache normally
        first_result = m.get_eval_metrics_by_task()
        # Cache is now set; a second call should hit the outer guard (line 108)
        # AND if somehow we bypass that, the inner guard at line 112.
        # We can verify the inner path by temporarily clearing + forcing a
        # concurrent-style scenario: set cache inside the lock window manually.
        _reset_ui_schema_caches()
        # Pre-populate before next call to simulate the "already populated"
        # scenario inside the lock.
        import lizystudio.backends.lizyml_metrics as metrics_mod

        metrics_mod._eval_metrics_cache = first_result  # type: ignore[attr-defined]
        result = m.get_eval_metrics_by_task()
        assert result is first_result
        _reset_ui_schema_caches()

    def test_get_metric_directions_inner_double_check_returns_cached(self) -> None:
        """Inner if-check inside lock returns cached directions."""
        import lizystudio.backends.lizyml_ui_schema as m

        first_result = m.get_metric_directions()
        _reset_ui_schema_caches()
        import lizystudio.backends.lizyml_metrics as metrics_mod2

        metrics_mod2._metric_direction_cache = first_result  # type: ignore[attr-defined]
        result = m.get_metric_directions()
        assert result is first_result
        _reset_ui_schema_caches()

    def test_get_metric_directions_individual_metric_lookup_exception(
        self,
        monkeypatch: object,
    ) -> None:
        """get_metric() exception falls back to minimize."""
        import lizystudio.backends.lizyml_ui_schema as m

        _reset_ui_schema_caches()
        # First populate eval metrics using real registry
        m.get_eval_metrics_by_task()

        # Now patch get_metric to always raise so every metric gets 'minimize'
        import lizyml.metrics.registry as reg

        original_get_metric = reg.get_metric

        def always_raises(name: str) -> object:
            raise ValueError(f"Cannot find metric: {name}")

        monkeypatch.setattr(reg, "get_metric", always_raises)  # type: ignore[attr-defined]
        try:
            result = m.get_metric_directions()
            for task_dirs in result.values():
                for direction in task_dirs.values():
                    assert direction == "minimize"
        finally:
            monkeypatch.setattr(reg, "get_metric", original_get_metric)  # type: ignore[attr-defined]
            _reset_ui_schema_caches()


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

    def test_get_ui_schema_validates_against_response_model(
        self, client: TestClient
    ) -> None:
        """``response_model=UiSchemaResponse`` (C-5) MUST accept the dict
        produced by :func:`build_ui_schema` without raising
        ``ResponseValidationError``.  Endpoint returning 200 already
        proves this, but we also re-validate the body through the
        Pydantic model to catch drift if the endpoint ever switches to
        another backend whose ``get_ui_schema()`` shape differs.
        """
        from lizystudio.api.models import UiSchemaResponse

        resp = client.get("/api/backends/ui-schema")
        assert resp.status_code == 200
        # Raises ValidationError if any field is missing / wrong type.
        model = UiSchemaResponse.model_validate(resp.json())
        assert model.capabilities is not None
        assert len(model.capabilities.cv_strategies) == 8
        assert len(model.search_space_catalog) > 0
        assert len(model.parameter_hints) > 0
