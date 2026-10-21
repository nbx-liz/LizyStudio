"""A tripwire on the refusal-location vocabulary the space classifier reads (P-0116 D1).

``_space_refusal_dims`` recognises a search-space refusal by the context keys
``surface`` and ``space_surface`` holding ``tuning.optuna.space`` or
``tune(space=)``.  These checks are a coarse source scan, not a proof:

* every quoted identifier ending in ``surface`` in lizyml's source is
  ``surface`` or ``space_surface``.  A new quoted ``*surface`` key fails it,
  related to refusals or not; a locator named otherwise is not seen;
* lizyml's ``SPACE_ARG`` is ``tune(space=)``, and ``tuning.optuna.space``
  still appears as a quoted literal in lizyml's source.

A failure means: re-measure the refusal contexts on the new lizyml and
revisit the classifier (DC3).
"""

from __future__ import annotations

import re
from pathlib import Path

import lizyml
import pytest

from lizystudio.backends.lizyml.lifecycle_mixin import _SPACE_SURFACES

pytestmark = pytest.mark.unit

_QUOTED_SURFACE_KEY = re.compile(r"[\"'](\w*surface)[\"']")
_CONFIG_SPACE = "tuning.optuna.space"


def _lizyml_source() -> str:
    root = Path(lizyml.__file__).parent
    return "\n".join(
        p.read_text(encoding="utf-8")
        for p in root.rglob("*.py")
        if "tests" not in p.parts
    )


def test_quoted_surface_keys_are_surface_and_space_surface() -> None:
    assert set(_QUOTED_SURFACE_KEY.findall(_lizyml_source())) == {
        "surface",
        "space_surface",
    }


def test_space_surface_values_still_exist_in_lizyml() -> None:
    from lizyml.core._tuning_space import SPACE_ARG

    assert frozenset({_CONFIG_SPACE, SPACE_ARG}) == _SPACE_SURFACES
    assert f'"{_CONFIG_SPACE}"' in _lizyml_source()
