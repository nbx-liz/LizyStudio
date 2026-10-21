"""The refusal-location vocabulary the space classifier relies on (P-0116 D1).

``_space_refusal_dims`` recognises a search-space refusal by two context keys,
``surface`` and ``space_surface``, holding one of two values.  That set was
measured over the installed lizyml; these checks fail when a lizyml upgrade
adds a key or renames a value, so the classifier is revisited instead of
silently letting a new refusal shape fall back to a generic error (DC3).
"""

from __future__ import annotations

import re
from pathlib import Path

import lizyml
import pytest

from lizystudio.backends.lizyml.lifecycle_mixin import _SPACE_SURFACES

pytestmark = pytest.mark.unit

_QUOTED_SURFACE_KEY = re.compile(r"[\"'](\w*surface)[\"']")


def _lizyml_sources() -> list[Path]:
    root = Path(lizyml.__file__).parent
    return [p for p in root.rglob("*.py") if "tests" not in p.parts]


def test_lizyml_locates_refusals_with_surface_and_space_surface_only() -> None:
    keys: set[str] = set()
    for path in _lizyml_sources():
        keys.update(_QUOTED_SURFACE_KEY.findall(path.read_text(encoding="utf-8")))
    assert keys == {"surface", "space_surface"}


def test_space_surface_values_match_lizyml() -> None:
    from lizyml.core._tuning_space import SPACE_ARG

    assert frozenset({"tuning.optuna.space", SPACE_ARG}) == _SPACE_SURFACES
