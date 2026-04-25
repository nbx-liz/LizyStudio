"""Contract: UI schema field lists must match the backend Pydantic schema.

Issue #258 / #259 surfaced when ``cv_strategy_fields`` declared
``stratified_kfold: [..., "shuffle"]`` but the lizyml ``StratifiedKFoldConfig``
Pydantic model did not accept ``shuffle``. The frontend trusted the UI
schema and appended ``shuffle: true`` to the payload, which ``POST /fit``
then rejected with 422.

This test locks the invariant: every field the UI schema claims a CV
strategy accepts must be a field the matching Pydantic variant (or a
sibling section like DataConfig for target/time_col/group_col) actually
accepts. Adding a field to the UI schema without extending the Pydantic
model fails this test.
"""

from __future__ import annotations

from typing import Any

import pytest

from lizystudio.backends.lizyml_ui_schema import (
    build_ui_schema,
    get_eval_metrics_by_task,
)

pytestmark = pytest.mark.unit


def _variant_fields_by_method(defs: dict[str, Any]) -> dict[str, set[str]]:
    """Map each CV method constant to the set of fields its Pydantic
    variant accepts (excluding the ``method`` discriminator itself).
    """
    out: dict[str, set[str]] = {}
    for schema in defs.values():
        props = schema.get("properties") or {}
        method_prop = props.get("method") or {}
        method_const = method_prop.get("const")
        if not method_const:
            continue
        out[method_const] = {k for k in props if k != "method"}
    return out


def _data_fields(defs: dict[str, Any]) -> set[str]:
    data = defs.get("DataConfig") or {}
    props = data.get("properties") or {}
    return set(props)


def test_cv_strategy_fields_match_pydantic_or_data() -> None:
    """Every field the UI schema declares for a CV strategy must be
    accepted either by the matching Pydantic CV variant (``split``
    payload) or by ``DataConfig`` (``data`` payload such as ``time_col``
    / ``group_col``).
    """
    from lizyml.config.schema import LizyMLConfig

    ui_schema = build_ui_schema(get_eval_metrics_by_task())
    cv_strategy_fields = ui_schema["capabilities"]["cv_strategy_fields"]

    defs = LizyMLConfig.model_json_schema().get("$defs", {})
    variant_fields = _variant_fields_by_method(defs)
    data_fields = _data_fields(defs)

    errors: list[str] = []
    for method, declared in cv_strategy_fields.items():
        pydantic_accepts = variant_fields.get(method, set())
        for field in declared:
            if field in pydantic_accepts:
                continue
            if field in data_fields:
                continue
            errors.append(
                f"ui_schema.cv_strategy_fields[{method!r}] declares "
                f"{field!r}, but Pydantic variant accepts "
                f"{sorted(pydantic_accepts)} and DataConfig accepts "
                f"{sorted(data_fields)}."
            )

    assert not errors, "\n".join(errors)


def test_every_ui_method_has_matching_pydantic_variant() -> None:
    """Every method the UI schema references must correspond to a real
    Pydantic variant. A typo or a deprecated method in
    ``cv_strategy_fields`` fails this guard.
    """
    from lizyml.config.schema import LizyMLConfig

    ui_schema = build_ui_schema(get_eval_metrics_by_task())
    cv_strategy_fields = ui_schema["capabilities"]["cv_strategy_fields"]

    defs = LizyMLConfig.model_json_schema().get("$defs", {})
    variant_fields = _variant_fields_by_method(defs)

    missing = [m for m in cv_strategy_fields if m not in variant_fields]
    assert not missing, (
        f"ui_schema.cv_strategy_fields references methods with no "
        f"matching Pydantic variant: {missing}"
    )


def test_frontend_fallback_matches_backend_cv_strategy_fields() -> None:
    """INV-4: The frontend boot-time fallback
    ``FALLBACK_CV_STRATEGY_FIELDS`` must match the backend's runtime
    ``cv_strategy_fields``. Without this lock, a backend-only edit
    lets the frontend fallback drift until the next UI schema fetch,
    and users who land on the page before fetch completes see a stale
    (possibly drifting) field list.

    The frontend fallback is declared in
    ``frontend/src/components/workspace/cv-state.ts``. This test reads
    it as text (string parsing is acceptable here because the file is
    TypeScript that cannot be imported into Python) and compares each
    strategy's list of fields to the backend SSOT.
    """
    import re
    from pathlib import Path

    ui_schema = build_ui_schema(get_eval_metrics_by_task())
    backend = ui_schema["capabilities"]["cv_strategy_fields"]

    ts_path = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "components"
        / "workspace"
        / "cv-state.ts"
    )
    source = ts_path.read_text(encoding="utf-8")

    # Locate the FALLBACK_CV_STRATEGY_FIELDS object literal body.
    marker = "export const FALLBACK_CV_STRATEGY_FIELDS"
    start = source.index(marker)
    brace_open = source.index("{", start)
    # Walk braces to find the matching close.
    depth = 0
    i = brace_open
    while i < len(source):
        ch = source[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = source[brace_open + 1 : i]

    # Parse ``strategy: [ "field1", "field2", ... ],`` entries.
    entry_pattern = re.compile(
        r"(\w+)\s*:\s*\[([^\]]*)\]",
        flags=re.MULTILINE,
    )
    frontend: dict[str, list[str]] = {}
    for match in entry_pattern.finditer(body):
        strategy = match.group(1)
        fields_src = match.group(2)
        fields = re.findall(r'"([^"]+)"', fields_src)
        frontend[strategy] = fields

    diffs: list[str] = []
    for strategy, expected in backend.items():
        got = frontend.get(strategy)
        if got is None:
            diffs.append(f"missing in frontend: {strategy}")
            continue
        if list(got) != list(expected):
            diffs.append(f"{strategy}: frontend={got} backend={list(expected)}")
    extra = set(frontend) - set(backend)
    if extra:
        diffs.append(f"extra in frontend: {sorted(extra)}")

    assert not diffs, (
        "FALLBACK_CV_STRATEGY_FIELDS in cv-state.ts does not match "
        "backend ui_schema.cv_strategy_fields:\n  " + "\n  ".join(diffs)
    )


def test_parameter_hints_do_not_shadow_smart_params() -> None:
    """Issue #265 regression guard.

    ``parameter_hints`` drives the Advanced Model Params section, which
    writes to ``model.params.<key>``. Smart Params (top-level fields on
    ``LGBMConfig`` like ``balanced``, ``auto_num_leaves``) write to
    ``model.<key>``. lizyml only reads Smart Params from ``model.<key>``
    (see ``LGBMProvider.extract_smart_params``), so a hint shadowing a
    Smart Params field renders a second toggle that silently drops the
    user's value into the wrong path.

    This test enumerates the LGBMConfig fields that are not native
    LightGBM ``params`` (i.e. all properties except ``name`` and
    ``params``) and asserts none of them appear as a parameter_hint key.
    """
    from lizyml.config.schema import LizyMLConfig

    ui_schema = build_ui_schema(get_eval_metrics_by_task())
    hint_keys = {h["key"] for h in ui_schema["parameter_hints"]}

    defs = LizyMLConfig.model_json_schema().get("$defs", {})
    lgbm = defs.get("LGBMConfig") or {}
    lgbm_props = set((lgbm.get("properties") or {}).keys())
    smart_param_keys = lgbm_props - {"name", "params"}

    overlap = hint_keys & smart_param_keys
    assert not overlap, (
        "parameter_hints must not shadow LGBMConfig Smart Params fields. "
        f"Found overlap: {sorted(overlap)}. These fields are written by "
        "the Smart Params section to model.<key>; including them in "
        "parameter_hints causes a duplicate Advanced toggle that writes "
        "to model.params.<key> and is silently dropped by lizyml."
    )
