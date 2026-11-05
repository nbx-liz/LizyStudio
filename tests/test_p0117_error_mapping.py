"""The classification table of lizyml refusals (P-0117 D2).

Every error here is raised by lizyml's own code (DC7): the table is fed
what the installed lizyml actually raises, not a hand-written exception.
The three reasons no Studio route can reach (a calendar or unitless
temporal category, ``categorical_feature_not_unique`` and
``column_name_collision``; see HISTORY.md P-0117 Decision, 2026-11-05
amendment) are covered here only; the reachable ones run end to end in
``tests/integration/test_p0117_lizyml_refusals.py``.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

import numpy as np
import pandas as pd
import pytest
from lizyml import Model
from lizyml.codegen.column_names import project_column_names
from lizyml.core.category_values import (
    check_keyless_temporals,
    encode,
    identity_fields,
)
from lizyml.core.exceptions import ErrorCode, LizyMLError
from lizyml.estimators.lgbm.adapter import categorical_positions

from lizystudio.api.errors import backend_error_from
from lizystudio.backends.exceptions import (
    BackendArtifactError,
    BackendInputError,
)
from lizystudio.backends.lizyml.error_mapping import (
    RULES,
    classify,
    lizyml_refusals,
    translated,
)


def _raised(fn: Callable[[], object]) -> LizyMLError:
    with pytest.raises(LizyMLError) as caught:
        fn()
    return caught.value


def _calendar_temporal() -> LizyMLError:
    return _raised(
        lambda: check_keyless_temporals(
            pd.Series([np.timedelta64(1, "M")], dtype=object), "c"
        )
    )


def _unitless_temporal() -> LizyMLError:
    return _raised(
        lambda: check_keyless_temporals(
            # A generic-unit datetime64 other than NaT (LizyML's own tests
            # build it the same way).
            pd.Series(
                [np.array(4, dtype=np.int64).view("datetime64")[()]], dtype=object
            ),
            "c",
        )
    )


def _not_unique() -> LizyMLError:
    return _raised(lambda: categorical_positions(["a", "a"], ["a"]))


def _collision() -> LizyMLError:
    return _raised(lambda: project_column_names([1, "1"], {}, []))


def _name_type() -> LizyMLError:
    return _raised(lambda: project_column_names([pd.Timestamp("2020-01-01")], {}, []))


def _value() -> LizyMLError:
    return _raised(lambda: encode(pd.Period("2020-01", "M")))


def _missing_model() -> LizyMLError:
    return _raised(lambda: Model.load("/nonexistent/lizystudio-p0117/model"))


def _bad_config() -> LizyMLError:
    return _raised(lambda: Model({"task": "binary"}))


# --- input refusals no Studio route reaches ----------------------------------


@pytest.mark.parametrize(
    ("make", "code", "reason", "column"),
    [
        (_calendar_temporal, "DATA_SCHEMA_INVALID", "calendar_timedelta64", "c"),
        (_unitless_temporal, "DATA_SCHEMA_INVALID", "unitless_datetime64", "c"),
        (_not_unique, "DATA_SCHEMA_INVALID", "categorical_feature_not_unique", "a"),
    ],
    ids=["calendar_timedelta64", "unitless_datetime64", "not_unique"],
)
def test_data_schema_refusals_are_input_errors(
    make: Callable[[], LizyMLError], code: str, reason: str, column: str
) -> None:
    exc = make()
    found = classify(exc)

    assert found.error_class == "input"
    assert found.backend_code == code
    assert found.reason == reason
    assert found.context["column"] == column
    assert found.remedy


def test_calendar_temporal_keeps_its_units() -> None:
    assert classify(_calendar_temporal()).context["units"] == ["M"]


@pytest.mark.parametrize(
    ("make", "reason", "kind"),
    [
        (_collision, "column_name_collision", "duplicate_alias"),
        (_name_type, "unsupported_column_name", "type"),
    ],
    ids=["collision", "type"],
)
def test_column_name_refusals_are_input_errors(
    make: Callable[[], LizyMLError], reason: str, kind: str
) -> None:
    found = classify(make())

    assert found.error_class == "input"
    assert found.backend_code == "SERIALIZATION_FAILED"
    assert found.reason == reason
    assert found.context["kind"] == kind
    assert found.context["surface"] == "export_code"


def test_a_free_text_reason_is_replaced_by_the_rule_default() -> None:
    # category_values.encode puts prose in ``reason`` ("the type Period").
    exc = _value()
    assert exc.context["reason"] == "the type Period"

    found = classify(exc)

    assert found.error_class == "input"
    assert found.reason == "unsaveable_value"
    assert found.context == {"type": "Period"}


# --- the generic class ---------------------------------------------------------


def test_a_code_the_table_does_not_know_stays_generic_with_its_code() -> None:
    exc = _bad_config()
    assert all(rule.code != "CONFIG_INVALID" for rule in RULES)

    found = classify(exc)

    assert found.error_class == "unclassified"
    assert found.backend_code == "CONFIG_INVALID"
    assert found.remedy is None
    assert translated(exc) is None


def test_a_future_code_with_an_input_shaped_context_stays_generic() -> None:
    # A code lizyml does not have today: the shape of its context alone
    # never makes it a 4xx (DC1).
    future = SimpleNamespace(
        code=SimpleNamespace(value="SOMETHING_NEW"),
        context={"column": "c", "reason": "brand_new_reason"},
    )

    found = classify(future)

    assert found.error_class == "unclassified"
    assert found.backend_code == "SOMETHING_NEW"
    assert found.reason == "brand_new_reason"


def test_a_load_failure_that_only_names_the_path_stays_generic() -> None:
    exc = _missing_model()
    assert exc.code.value == "DESERIALIZATION_FAILED"
    assert set(exc.context) == {"path"}

    found = classify(exc)

    assert found.error_class == "unclassified"
    assert found.backend_code == "DESERIALIZATION_FAILED"
    assert "path" not in found.context


def test_the_generic_class_propagates_the_original_error() -> None:
    exc = _bad_config()
    with pytest.raises(LizyMLError) as caught, lizyml_refusals():
        raise exc
    assert caught.value is exc


@pytest.mark.parametrize("key", ["path", "exception"])
def test_unsafe_context_keys_are_never_carried(key: str) -> None:
    exc = _calendar_temporal()
    exc.context[key] = "/home/someone/secret"

    found = classify(exc)

    assert key not in found.context


def test_an_input_shaped_error_that_names_a_file_is_not_an_input_error() -> None:
    # An input refusal passes lizyml's message on; one that locates a file
    # is an I/O failure whose message may hold the path.
    exc = _not_unique()
    exc.context["path"] = "/home/someone/model"

    assert classify(exc).error_class == "unclassified"


# --- translation ----------------------------------------------------------------


def test_input_refusals_become_400_with_code_reason_and_remedy() -> None:
    exc = _not_unique()
    with pytest.raises(BackendInputError) as caught, lizyml_refusals():
        raise exc
    refusal = caught.value
    assert refusal.__cause__ is exc

    envelope = backend_error_from(refusal)

    assert envelope.status_code == 400
    assert envelope.code == "BACKEND_INPUT_REJECTED"
    assert envelope.message == exc.user_message
    assert envelope.details == {
        "backend_code": "DATA_SCHEMA_INVALID",
        "reason": "categorical_feature_not_unique",
        "recovery_hint": refusal.remedy,
        "context": {"column": "a"},
    }


def test_artifact_refusals_become_409_with_fixed_text() -> None:
    # A real identity refusal, given the absolute path Model.load adds to
    # its context: the artifact class passes neither on.
    exc = _raised(
        lambda: identity_fields(
            {"category_identity_version": 7, "identity_columns": [], "categories": {}}
        )
    )
    exc.context["path"] = "/home/someone/model"
    refusal = translated(exc)
    assert isinstance(refusal, BackendArtifactError)

    envelope = backend_error_from(refusal)

    assert envelope.status_code == 409
    assert envelope.code == "MODEL_ARTIFACT_INVALID"
    assert envelope.details["backend_code"] == "DESERIALIZATION_FAILED"
    assert envelope.details["reason"] == "unknown_category_identity_version"
    assert envelope.details["context"] == {}
    assert "/home/someone" not in envelope.message
    assert "/home/someone" not in repr(envelope.details)


def test_other_errors_stay_500_backend_error() -> None:
    envelope = backend_error_from(_bad_config())

    assert envelope.status_code == 500
    assert envelope.code == "BACKEND_ERROR"


@pytest.mark.parametrize("rule", RULES, ids=lambda r: f"{r.code}:{r.reason}")
def test_every_rule_names_a_class_reason_and_remedy(rule: Any) -> None:
    assert rule.error_class in {"input", "artifact"}
    assert rule.reason
    assert rule.remedy


# --- round 1 of the head review (PR #750) -----------------------------------


@pytest.mark.parametrize(
    "context",
    [
        # A shape no lizyml 0.21.1 raise site produces.
        {"something_new": 1},
        # A reason lizyml may add for a load failure.
        {"reason": "brand_new_reason", "file": "fit_result.pkl"},
        # persistence/loader.py _verify_and_read_pkl on OSError: an I/O
        # failure, not a damaged artifact (the real raise is run end to end
        # in the integration suite).
        {"file": "refit_model.pkl"},
        # Only part of the checksum shape.
        {"file": "refit_model.pkl", "expected": "0" * 64},
        # Only part of the format shape.
        {"format_version": 9},
    ],
    ids=["unknown", "new-reason", "io-file-only", "partial-digest", "partial-format"],
)
def test_an_unknown_load_failure_shape_stays_generic(context: dict[str, Any]) -> None:
    # Hand-built: the point is a shape lizyml does not raise today.
    exc = LizyMLError(ErrorCode.DESERIALIZATION_FAILED, "m", context=context)

    found = classify(exc)

    assert found.error_class == "unclassified"
    assert found.context == {}
    assert translated(exc) is None


def test_a_non_finite_value_in_an_input_context_is_json_safe() -> None:
    # A real raise whose context carries a float infinity.
    exc = _raised(lambda: categorical_positions(["a"], [float("inf")]))
    assert exc.context["column"] == float("inf")

    found = classify(exc)

    assert found.error_class == "input"
    assert found.context["column"] == "inf"
    json.dumps(found.context, allow_nan=False)


def test_a_non_finite_format_version_is_dropped_from_the_artifact_context() -> None:
    exc = LizyMLError(
        ErrorCode.DESERIALIZATION_FAILED,
        "m",
        context={"format_version": float("inf"), "supported": [1, 2, 3, 4, 5]},
    )

    found = classify(exc)

    assert found.error_class == "artifact"
    assert found.reason == "unsupported_format_version"
    assert found.context == {"supported": [1, 2, 3, 4, 5]}


@pytest.mark.parametrize(
    "file", ["/home/someone/refit_model.pkl", "../refit_model.pkl", "a b.pkl"]
)
def test_a_checksum_refusal_shows_only_a_bare_file_name(file: str) -> None:
    exc = LizyMLError(
        ErrorCode.DESERIALIZATION_FAILED,
        "m",
        context={"file": file, "expected": "0" * 64, "actual": "1" * 64},
    )

    found = classify(exc)

    assert found.error_class == "artifact"
    assert found.reason == "checksum_mismatch"
    assert found.context == {}


def test_an_identity_marker_holding_a_path_is_not_echoed() -> None:
    exc = _raised(
        lambda: identity_fields(
            {
                "category_identity_version": "/home/someone/secret",
                "identity_columns": [],
                "categories": {},
            }
        )
    )
    assert "/home/someone" in exc.context["category_identity_version"]

    envelope = backend_error_from(translated(exc) or exc)

    assert envelope.status_code == 409
    assert envelope.details["context"] == {}
    assert "/home/someone" not in envelope.message
    assert "/home/someone" not in json.dumps(envelope.details)
