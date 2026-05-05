"""Validate API metric-compatibility contract (Issue #394 / PR-C2).

The pre-PR-C2 ``validate_config`` accepted any combination of
``evaluation.metrics`` because the Pydantic schema does not know about
the loaded dataset's target shape. As a result, configurations like
``mape`` on a target column that contains zeros would pass Validate,
get accepted by ``POST /fit``, and fail mid-fold with a confusing
``LizyMLError(UNSUPPORTED_METRIC)`` from the lizyml regression metric
helper.

PR-C2 surfaces these mismatches up-front as ``severity="warning"``
entries on the validate envelope so the frontend can render a yellow
banner with the per-metric ``suggested_fix`` instead of letting the
fit run for several seconds and then fail. The shape mismatches we
detect today (regression task only):

* ``mape``  — undefined when any target value is 0
* ``rmsle`` — undefined when any target value is < 0
* ``r2``    — undefined when the target column is constant (variance 0)

This file pins the contract: trigger conditions, severity assignment,
``suggested_fix`` text shape, and the negative cases (no data, valid
target, non-numeric target, malformed input).
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_regression_csv(
    tmp_path: Path,
    *,
    target_values: list[float],
    name: str = "train.csv",
) -> str:
    """Stage a 3-column CSV with the requested target values."""
    csv_path = tmp_path / name
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["a", "b", "y"])
        for i, val in enumerate(target_values):
            writer.writerow([i, i + 1, val])
    return str(csv_path)


def _load_data(client: TestClient, csv_path: str) -> None:
    res = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert res.status_code == 200, res.text


def _regression_defaults(client: TestClient, target: str = "y") -> dict[str, Any]:
    res = client.get(
        f"/api/workspace/config/defaults?task=regression&target={target}",
    )
    assert res.status_code == 200, res.text
    return res.json()


def _set_metrics(config: dict[str, Any], metric_names: list[str]) -> dict[str, Any]:
    """Replace ``evaluation.metrics`` with a fresh list of plain names."""
    config = dict(config)
    evaluation = dict(config.get("evaluation", {}))
    evaluation["metrics"] = list(metric_names)
    config["evaluation"] = evaluation
    return config


def _validate(client: TestClient, config: dict[str, Any]) -> list[dict[str, Any]]:
    res = client.post("/api/workspace/config/validate", json=config)
    assert res.status_code == 200, res.text
    return res.json()["errors"]


def _metric_warnings(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return entries the metric-compat validator owns."""
    return [e for e in errors if e.get("path") == "evaluation.metrics"]


# ---------------------------------------------------------------------------
# Positive cases — each trigger surfaces exactly one warning
# ---------------------------------------------------------------------------


def test_mape_with_zero_target_emits_warning(
    client: TestClient, tmp_path: Path
) -> None:
    """A regression target containing 0 must flag ``mape`` as
    incompatible. The suggested fix names sMAPE / WAPE as zero-tolerant
    replacements (lizyml >= 0.11.0)."""
    csv_path = _create_regression_csv(
        tmp_path, target_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae", "mape"])
    errors = _validate(client, config)

    warnings = _metric_warnings(errors)
    assert len(warnings) == 1, errors
    err = warnings[0]
    assert err["severity"] == "warning"
    assert err["suggested_fix"] is not None
    assert "mape" in err["message"].lower()
    assert "smape" in err["suggested_fix"].lower()
    assert "wape" in err["suggested_fix"].lower()


def test_rmsle_with_negative_target_emits_warning(
    client: TestClient, tmp_path: Path
) -> None:
    """RMSLE is undefined for negative ``y_true`` (the inner ``log1p``
    breaks). The validator must catch this before fit time."""
    csv_path = _create_regression_csv(
        tmp_path, target_values=[-1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae", "rmsle"])
    errors = _validate(client, config)

    warnings = _metric_warnings(errors)
    assert len(warnings) == 1, errors
    err = warnings[0]
    assert err["severity"] == "warning"
    assert err["suggested_fix"] is not None
    assert "rmsle" in err["message"].lower()
    assert "rmsle" in err["suggested_fix"].lower()


def test_r2_with_constant_target_emits_warning(
    client: TestClient, tmp_path: Path
) -> None:
    """R² is degenerate when the target has zero variance. Surface a
    warning rather than letting the fold loop surface a NaN later."""
    csv_path = _create_regression_csv(tmp_path, target_values=[5.0] * 10)
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae", "r2"])
    errors = _validate(client, config)

    warnings = _metric_warnings(errors)
    assert len(warnings) == 1, errors
    err = warnings[0]
    assert err["severity"] == "warning"
    assert err["suggested_fix"] is not None
    assert "r2" in err["message"].lower() or "r²" in err["message"].lower()
    assert "r2" in err["suggested_fix"].lower()


def test_multiple_metric_issues_emit_one_warning_each(
    client: TestClient, tmp_path: Path
) -> None:
    """A single config with two bad metrics surfaces two warnings — one
    per metric — so the user can resolve each independently."""
    # Target contains both 0 (kills mape) and a negative value (kills
    # rmsle); the rest are non-degenerate so std() != 0.
    csv_path = _create_regression_csv(
        tmp_path, target_values=[0.0, -1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae", "mape", "rmsle"])
    errors = _validate(client, config)

    warnings = _metric_warnings(errors)
    paths = [e["path"] for e in warnings]
    messages = [e["message"].lower() for e in warnings]
    assert len(warnings) == 2, errors
    assert paths.count("evaluation.metrics") == 2
    assert any("mape" in m for m in messages)
    assert any("rmsle" in m for m in messages)


# ---------------------------------------------------------------------------
# Negative cases — quiet when there is nothing to flag
# ---------------------------------------------------------------------------


def test_no_warning_when_target_has_no_zero_or_negative(
    client: TestClient, tmp_path: Path
) -> None:
    """Strictly-positive non-constant target keeps mape/rmsle/r2 valid."""
    csv_path = _create_regression_csv(
        tmp_path, target_values=[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae", "mape", "rmsle", "r2"])
    errors = _validate(client, config)
    assert _metric_warnings(errors) == []


def test_no_warning_when_no_data_loaded(client: TestClient) -> None:
    """The validator must short-circuit before reading the dataframe.

    Without a loaded CSV the row-count and target-value preconditions
    cannot be checked at all; the metric-compat validator stays quiet
    so the user does not see warnings for a workspace that has no data
    to disagree with.
    """
    # ``_regression_defaults`` calls /defaults which does not require
    # data; we then validate a config that *would* trigger mape if data
    # were loaded. No CSV ever reaches the workspace.
    config = _set_metrics(_regression_defaults(client), ["mae", "mape"])
    errors = _validate(client, config)
    assert _metric_warnings(errors) == []


def test_no_warning_for_metrics_not_in_the_compat_list(
    client: TestClient, tmp_path: Path
) -> None:
    """Metrics outside the {mape, rmsle, r2} watchlist are ignored even
    on a target that would trigger the watchlist members.

    This guards against the validator getting clever and over-warning
    for metrics it does not actually understand.
    """
    csv_path = _create_regression_csv(
        tmp_path, target_values=[0.0, -1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae", "rmse", "huber"])
    errors = _validate(client, config)
    assert _metric_warnings(errors) == []


def test_warning_does_not_block_validate_valid_flag(
    client: TestClient, tmp_path: Path
) -> None:
    """Warnings advise but do not invalidate a config — the response's
    ``valid`` flag still reflects whether *errors* exist."""
    csv_path = _create_regression_csv(
        tmp_path, target_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae", "mape"])
    res = client.post("/api/workspace/config/validate", json=config)
    assert res.status_code == 200, res.text
    body = res.json()
    # The schema-level body is fine; only a workspace-aware warning is
    # raised. ``valid`` must therefore stay True so that frontend
    # gating logic that filters on severity decides Fit eligibility,
    # not the bare ``valid`` boolean.
    assert body["valid"] is True
    warnings = _metric_warnings(body["errors"])
    assert len(warnings) == 1
    assert warnings[0]["severity"] == "warning"


# ---------------------------------------------------------------------------
# Defensive cases — malformed metrics list / parameterised metric entries
# ---------------------------------------------------------------------------


def test_parameterised_metric_entry_is_recognised(
    client: TestClient, tmp_path: Path
) -> None:
    """Metrics may arrive as ``{name: params}`` dicts (e.g.
    ``precision_at_k``). The validator must extract the name without
    raising even when the value is a dict, and still flag the watchlist
    entries the user has selected.
    """
    csv_path = _create_regression_csv(
        tmp_path, target_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae"])
    # Inject a dict-form mape entry by hand; the schema accepts both
    # plain strings and parameterised dicts.
    config["evaluation"]["metrics"].append({"mape": {}})
    errors = _validate(client, config)

    warnings = _metric_warnings(errors)
    assert len(warnings) == 1
    assert "mape" in warnings[0]["message"].lower()


# ---------------------------------------------------------------------------
# Edge cases — Issue #404 follow-up
#
# These pin the helper's defensive behaviour against degenerate target
# columns (all-NaN, ±inf), parametric input shapes (int64 vs float64,
# duplicates, malformed dict entries) and out-of-shape ``evaluation``
# fields. Together with the positive cases above they take the contract
# coverage from 9 cases to 16, fully covering the PR-C2 + PR-D1 watchlist
# logic so R-1 / R-3 work that touches the validate path inherits a
# locked surface.
# ---------------------------------------------------------------------------


def test_target_all_nan_does_not_crash(client: TestClient, tmp_path: Path) -> None:
    """All-NaN target degenerates std() to NaN. The R² guard
    short-circuits on ``pd.isna(std)`` and emits the constant-target
    warning; mape / rmsle stay quiet because comparisons against NaN
    return False, not True. The validator must complete without
    raising on a column pandas reads as a numeric column of NaNs."""
    # An empty CSV cell is read by pandas as NaN; stage 10 such rows.
    csv_path = tmp_path / "all_nan.csv"
    with csv_path.open("w") as f:
        f.write("a,b,y\n")
        for i in range(10):
            f.write(f"{i},{i + 1},\n")
    _load_data(client, str(csv_path))

    config = _set_metrics(_regression_defaults(client), ["mae", "mape", "rmsle", "r2"])
    # Helper must not raise; whether r2 is flagged depends on whether
    # pandas treats the empty target as numeric — both outcomes are
    # acceptable as long as no exception escapes.
    errors = _validate(client, config)
    metric_paths = [e["path"] for e in _metric_warnings(errors)]
    # mape / rmsle never fire on all-NaN (NaN comparisons are False)
    for warn in _metric_warnings(errors):
        assert "mape" not in warn["message"].lower()
        assert "rmsle" not in warn["message"].lower()
    # And the helper definitely completed — duplicate-path is fine
    assert all(p == "evaluation.metrics" for p in metric_paths)


def test_target_with_inf_does_not_crash(client: TestClient, tmp_path: Path) -> None:
    """Inf and -inf in the target column are pandas-numeric (float64)
    and must not break the helper. Specifically:

    * ``mape`` does NOT fire on ``inf`` because ``inf == 0`` is False
    * ``rmsle`` DOES fire on ``-inf`` because ``-inf < 0`` is True
    * neither check raises a Python exception
    """
    csv_path = _create_regression_csv(
        tmp_path,
        target_values=[
            float("inf"),
            float("-inf"),
            1.0,
            2.0,
            3.0,
            4.0,
            5.0,
            6.0,
            7.0,
            8.0,
        ],
    )
    _load_data(client, csv_path)

    config = _set_metrics(_regression_defaults(client), ["mape", "rmsle"])
    errors = _validate(client, config)
    warnings = _metric_warnings(errors)
    messages = [w["message"].lower() for w in warnings]

    # MAPE quiet — no exact zero in the target
    assert not any("mape" in m for m in messages), warnings
    # RMSLE fires — -inf qualifies as negative
    assert any("rmsle" in m for m in messages), warnings


def test_target_int64_and_float64_yield_consistent_warnings(
    client: TestClient, tmp_path: Path
) -> None:
    """The validator should not depend on whether pandas inferred the
    target as int64 or float64. A target of ``[0, 1, 2, ...]`` (int64)
    and ``[0.0, 1.0, 2.0, ...]`` (float64) must both flag MAPE and
    neither one extra metric."""
    int_path = _create_regression_csv(
        tmp_path,
        target_values=[0, 1, 2, 3, 4, 5, 6, 7, 8, 9],  # type: ignore[list-item]
        name="int_target.csv",
    )
    _load_data(client, int_path)
    config = _set_metrics(_regression_defaults(client), ["mape"])
    int_warnings = _metric_warnings(_validate(client, config))

    float_path = _create_regression_csv(
        tmp_path,
        target_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0],
        name="float_target.csv",
    )
    _load_data(client, float_path)
    float_warnings = _metric_warnings(_validate(client, config))

    assert len(int_warnings) == len(float_warnings) == 1
    # Same metric flagged, identical suggested_fix text
    assert int_warnings[0]["suggested_fix"] == float_warnings[0]["suggested_fix"]


def test_duplicate_metric_names_emit_a_single_warning(
    client: TestClient, tmp_path: Path
) -> None:
    """Backend dedup uses a set, so ``["mae", "mape", "mape"]`` must
    surface exactly one MAPE warning. Frontends that copy-paste metric
    chips can produce duplicates and we should not punish that with
    duplicated banners."""
    csv_path = _create_regression_csv(
        tmp_path, target_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae", "mape", "mape"])
    warnings = _metric_warnings(_validate(client, config))
    assert len(warnings) == 1
    assert "mape" in warnings[0]["message"].lower()


def test_malformed_metric_entries_are_skipped(
    client: TestClient, tmp_path: Path
) -> None:
    """``_metric_entry_name`` returns None for empty dicts, multi-key
    dicts, and dicts with non-string keys. Such entries must be silently
    skipped — they may also be rejected by Pydantic, but that is not
    this helper's responsibility. The contract here is purely that we
    do not raise."""
    csv_path = _create_regression_csv(
        tmp_path, target_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    )
    _load_data(client, csv_path)
    config = _set_metrics(_regression_defaults(client), ["mae"])
    # The Pydantic schema may reject these; we still want the helper to
    # be defensive enough that a backend round-trip would not 500.
    config["evaluation"]["metrics"].extend(
        [
            {},  # empty dict — no key
            {"mape": {}, "rmsle": {}},  # multi-key dict — ambiguous
        ]
    )
    res = client.post("/api/workspace/config/validate", json=config)
    # Whatever Pydantic does, this must not 5xx.
    assert res.status_code == 200, res.text
    # The malformed entries are dropped; metric-compat watchlist sees
    # only the plain-string ``mae``, which is not on the watchlist, so
    # no metric warnings.
    warnings = _metric_warnings(res.json()["errors"])
    for w in warnings:
        # If anything is flagged it must reference one of the watchlist
        # names — we never invent a name from a malformed entry.
        msg = w["message"].lower()
        assert any(k in msg for k in ("mape", "rmsle", "r2"))


def test_evaluation_field_non_dict_does_not_crash(
    client: TestClient, tmp_path: Path
) -> None:
    """``config["evaluation"]`` may arrive as a list, ``None``, or be
    omitted entirely. Each shape must short-circuit to "no metric
    warning" without raising — the Pydantic layer handles its own
    rejection separately."""
    csv_path = _create_regression_csv(
        tmp_path, target_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]
    )
    _load_data(client, csv_path)
    base = _regression_defaults(client)

    # 1) evaluation = []  -> not a dict -> no metric warning
    list_config = dict(base)
    list_config["evaluation"] = []
    res_list = client.post("/api/workspace/config/validate", json=list_config)
    assert res_list.status_code == 200, res_list.text
    assert _metric_warnings(res_list.json()["errors"]) == []

    # 2) evaluation = None
    none_config = dict(base)
    none_config["evaluation"] = None
    res_none = client.post("/api/workspace/config/validate", json=none_config)
    assert res_none.status_code == 200, res_none.text
    assert _metric_warnings(res_none.json()["errors"]) == []

    # 3) evaluation key absent entirely
    missing_config = {k: v for k, v in base.items() if k != "evaluation"}
    res_missing = client.post("/api/workspace/config/validate", json=missing_config)
    assert res_missing.status_code == 200, res_missing.text
    assert _metric_warnings(res_missing.json()["errors"]) == []
