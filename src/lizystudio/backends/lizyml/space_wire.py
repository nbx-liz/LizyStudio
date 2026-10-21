"""The lizyml wire form of the Tune search space (P-0116 D1, Issue #721).

Studio keys the search space by its UI catalog key everywhere above the
adapter: the workspace config, the job snapshot and ``TuneTab`` all read
``tuning.optuna.space`` by catalog key.  The adapter translates it at the
``create_model`` boundary into what lizyml reads:

* the lizyml parameter name (``early_stopping.rounds`` -> ``early_stopping_rounds``);
* the ``category`` lizyml routes the dim by.  The UI ``group`` is not that
  category: ``num_leaves`` sits with the smart params in the UI, but lizyml
  refuses it as ``category: smart``.  :data:`WIRE_TABLE` is the single source;
  a category sent by the client is ignored for catalog names;
* boolean choices as booleans.  The UI sends ``"true"``/``"false"``, and
  ``"false"`` is truthy, so a smart switch was trained on (Issue #689);
* no dim whose owner can never be on (see :func:`to_wire_space`).

Names outside the catalog pass through unchanged, so lizyml applies its own
default (``category: model``) and judges them.

The ``fit_dest`` column gives each row's place in a Fit config.  It is
declared here so the table covers every catalog row; the five writers that
build Fit configs from tune results move onto it separately (P-0116 D2).
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Literal

from lizystudio.backends.lizyml_ui_schema import _SEARCH_SPACE_CATALOG

Category = Literal["model", "smart", "training"]


class WireNameCollisionError(ValueError):
    """Two space entries name the same lizyml parameter.

    For example the catalog key ``early_stopping.rounds`` and a hand-written
    ``early_stopping_rounds``.  Keeping either one would silently drop the
    other, so the space is refused instead.
    """

    def __init__(self, first_key: str, second_key: str, wire_name: str) -> None:
        self.first_key = first_key
        self.second_key = second_key
        self.wire_name = wire_name
        super().__init__(
            f"'{first_key}' and '{second_key}' both set the lizyml parameter "
            f"'{wire_name}'; keep only one of them."
        )


@dataclass(frozen=True)
class WireRow:
    """How one catalog row reaches lizyml.

    ``category`` is ``None`` for fixed-only rows: they never become a search
    dim.  ``fit_dest`` is the dotted path of the row's value in a Fit config.
    """

    wire_name: str
    category: Category | None
    fit_dest: str


def _model_param(key: str) -> WireRow:
    return WireRow(key, "model", f"model.params.{key}")


def _smart(key: str) -> WireRow:
    return WireRow(key, "smart", f"model.{key}")


WIRE_TABLE: dict[str, WireRow] = {
    # Smart params: LGBMConfig fields, not LightGBM parameters.
    "auto_num_leaves": _smart("auto_num_leaves"),
    "num_leaves_ratio": _smart("num_leaves_ratio"),
    "min_data_in_leaf_ratio": _smart("min_data_in_leaf_ratio"),
    "min_data_in_bin_ratio": _smart("min_data_in_bin_ratio"),
    "feature_weights": WireRow("feature_weights", None, "model.feature_weights"),
    "balanced": _smart("balanced"),
    # Native LightGBM parameters, num_leaves included.
    "num_leaves": _model_param("num_leaves"),
    "objective": _model_param("objective"),
    "metric": _model_param("metric"),
    "first_metric_only": _model_param("first_metric_only"),
    "n_estimators": _model_param("n_estimators"),
    "learning_rate": _model_param("learning_rate"),
    "max_depth": _model_param("max_depth"),
    "max_bin": _model_param("max_bin"),
    "feature_fraction": _model_param("feature_fraction"),
    "bagging_fraction": _model_param("bagging_fraction"),
    "bagging_freq": _model_param("bagging_freq"),
    "lambda_l1": WireRow("lambda_l1", None, "model.params.lambda_l1"),
    "lambda_l2": _model_param("lambda_l2"),
    "verbose": WireRow("verbose", None, "model.params.verbose"),
    # Training settings.  Only early_stopping_rounds and validation_ratio are
    # tunable training names in lizyml.
    "seed": WireRow("seed", None, "training.seed"),
    "early_stopping.enabled": WireRow(
        "early_stopping.enabled", None, "training.early_stopping.enabled"
    ),
    "early_stopping.rounds": WireRow(
        "early_stopping_rounds", "training", "training.early_stopping.rounds"
    ),
    "validation_ratio": WireRow(
        "validation_ratio", "training", "training.early_stopping.inner_valid"
    ),
    "inner_valid": WireRow("inner_valid", None, "training.early_stopping.inner_valid"),
}

_BOOLEAN_KEYS: frozenset[str] = frozenset(
    entry["key"]
    for entry in _SEARCH_SPACE_CATALOG
    if entry.get("paramType") == "boolean"
)
_BOOL_STRINGS: dict[str, bool] = {"true": True, "false": False}

# Dims read only while their owner is on.  num_leaves_ratio is lizyml's rule;
# the training dims are a Studio policy (a tuned early_stopping_rounds would
# switch early stopping back on against the user's fixed choice).
_AUTO_NUM_LEAVES_DIMS: frozenset[str] = frozenset({"num_leaves_ratio"})
_EARLY_STOPPING_DIMS: frozenset[str] = frozenset(
    {"early_stopping.rounds", "validation_ratio"}
)


def _coerce_boolean_choices(entry: dict[str, Any]) -> dict[str, Any]:
    choices = entry.get("choices")
    if not isinstance(choices, list):
        return entry
    coerced = [
        _BOOL_STRINGS[c] if isinstance(c, str) and c in _BOOL_STRINGS else c
        for c in choices
    ]
    return {**entry, "choices": coerced}


def _can_be_true(space: dict[str, Any], dim_key: str, fixed_value: Any) -> bool:
    """Whether a boolean owner can be true in this tune.

    A search dim for the owner wins over its fixed value.  An absent fixed
    value counts as on: lizyml defaults both owners to true.
    """
    dim = space.get(dim_key)
    if isinstance(dim, dict):
        choices = _coerce_boolean_choices(dim).get("choices")
        return isinstance(choices, list) and True in choices
    return fixed_value is not False


def _section(config: dict[str, Any], name: str) -> dict[str, Any]:
    value = config.get(name)
    return value if isinstance(value, dict) else {}


def to_wire_entry(key: str, raw: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Return the wire name and a wire-form copy of one catalog-keyed dim.

    Owner rules need the whole space and config, so they are not applied
    here; :func:`to_wire_space` applies them.
    """
    entry = copy.deepcopy(raw)
    row = WIRE_TABLE.get(key)
    if row is None:
        return key, entry
    if key in _BOOLEAN_KEYS:
        entry = _coerce_boolean_choices(entry)
    if row.category is not None:
        entry["category"] = row.category
    return row.wire_name, entry


def to_wire_space(space: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """Translate a catalog-keyed *space* into lizyml's wire form.

    *config* supplies the owners' fixed values (``model.auto_num_leaves`` and
    ``training.early_stopping.enabled``).  Neither argument is mutated.
    """
    model = _section(config, "model")
    early_stopping = _section(_section(config, "training"), "early_stopping")
    auto_on = _can_be_true(space, "auto_num_leaves", model.get("auto_num_leaves"))
    es_on = _can_be_true(space, "early_stopping.enabled", early_stopping.get("enabled"))

    out: dict[str, Any] = {}
    sources: dict[str, str] = {}
    for key, raw in space.items():
        if not isinstance(raw, dict):
            wire_name, entry = key, copy.deepcopy(raw)
        elif (
            key in _AUTO_NUM_LEAVES_DIMS
            and not auto_on
            or key in _EARLY_STOPPING_DIMS
            and not es_on
        ):
            continue
        else:
            wire_name, entry = to_wire_entry(key, raw)
        if wire_name in sources:
            raise WireNameCollisionError(sources[wire_name], key, wire_name)
        sources[wire_name] = key
        out[wire_name] = entry
    return out


def find_wire_name_collisions(space: dict[str, Any]) -> list[WireNameCollisionError]:
    """Every entry of *space* whose wire name an earlier entry already took."""
    sources: dict[str, str] = {}
    found: list[WireNameCollisionError] = []
    for key in space:
        row = WIRE_TABLE.get(key)
        wire_name = row.wire_name if row is not None else key
        if wire_name in sources:
            found.append(WireNameCollisionError(sources[wire_name], key, wire_name))
        else:
            sources[wire_name] = key
    return found


def to_wire_config(config: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of *config* whose ``tuning.optuna.space`` is in wire form.

    A config without a non-empty space (every Fit job) is returned as is.
    """
    tuning = config.get("tuning")
    optuna = tuning.get("optuna") if isinstance(tuning, dict) else None
    space = optuna.get("space") if isinstance(optuna, dict) else None
    if not isinstance(space, dict) or not space:
        return config
    out = copy.deepcopy(config)
    out["tuning"]["optuna"]["space"] = to_wire_space(space, config)
    return out
