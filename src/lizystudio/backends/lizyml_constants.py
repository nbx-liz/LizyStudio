"""Constants and small helpers for the LizyML backend UI schema."""

from __future__ import annotations

# Keys already covered by parameter_hints or search_space_catalog.
# additional_params must exclude these to avoid UI duplication.
_KNOWN_PARAM_KEYS: frozenset[str] = frozenset(
    {
        "objective",
        "metric",
        "n_estimators",
        "learning_rate",
        "max_depth",
        "max_bin",
        "feature_fraction",
        "bagging_fraction",
        "bagging_freq",
        "lambda_l1",
        "lambda_l2",
        "first_metric_only",
        "verbose",
        "num_threads",  # Excluded from UI intentionally (server-managed)
        "num_leaves",
        # Smart params (in search_space_catalog)
        "auto_num_leaves",
        "num_leaves_ratio",
        "min_data_in_leaf_ratio",
        "min_data_in_bin_ratio",
        "feature_weights",
        "balanced",
    }
)

# LightGBM parameters available as additional params (beyond hints/catalog).
_LGBM_ADDITIONAL_PARAMS: list[str] = sorted(
    [
        "min_child_weight",
        "min_child_samples",
        "subsample",
        "colsample_bytree",
        "reg_alpha",
        "reg_lambda",
        "max_cat_threshold",
        "cat_smooth",
        "cat_l2",
        "extra_trees",
        "path_smooth",
        "min_gain_to_split",
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
        "is_unbalance",
        "scale_pos_weight",
        "sigmoid",
        "boost_from_average",
        "bin_construct_sample_cnt",
        "data_sample_strategy",
        "interaction_constraints",
    ]
)


def _build_additional_params() -> list[str]:
    """Return LightGBM params not in parameter_hints or search_space_catalog."""
    return [p for p in _LGBM_ADDITIONAL_PARAMS if p not in _KNOWN_PARAM_KEYS]
