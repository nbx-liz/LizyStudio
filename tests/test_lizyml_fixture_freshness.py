"""Production fixtures and the pickle matrix track the installed lizyml (P-0116 c8).

Owner ruling D-20261022-005: this runs in PR CI, so a lizyml minor bump
re-captures the fixtures (``frontend/tests/fixture-capture/``) and moves
``PAST_VERSIONS`` in the same PR.  The checks:

* the README's capture version, every scenario's ``metadata.json`` and the
  installed lizyml share one major.minor;
* every ``config.json`` has the shape today's UI writes;
* every frontend mirror equals its backend copy as JSON;
* no fixture leaks a local path, and every file parses as strict JSON;
* the three lists of past lizyml minors (matrix script, nightly workflow,
  bench test) are equal and are the three minors below the installed one.

Every reader fails on a missing file or an unmatched pattern (DC1).
"""

from __future__ import annotations

import json
import re
from importlib.metadata import version
from pathlib import Path
from typing import Any

import pytest
import yaml

from lizystudio.backends.lizyml.pickle_compat import major_minor
from lizystudio.backends.lizyml_ui_schema import _build_eval_metric_option_sets

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "lizyml"
MIRRORS = ROOT / "frontend" / "src" / "__fixtures__" / "lizyml"

# Explicit, not a glob: ``wide/`` lives beside them and is generated.
SCENARIOS = ("binary_no_cal", "binary_isotonic", "regression", "tune")
FILES = {
    "binary_no_cal": ("config.json", "fit_result.json", "metadata.json"),
    "binary_isotonic": ("config.json", "fit_result.json", "metadata.json"),
    "regression": ("config.json", "fit_result.json", "metadata.json"),
    "tune": ("config.json", "fit_result.json", "metadata.json", "tune_result.json"),
}
MIRROR_OF = {
    **{
        MIRRORS / f"fit_result_{s}.json": FIXTURES / s / "fit_result.json"
        for s in SCENARIOS
    },
    MIRRORS / "tune_result_tune.json": FIXTURES / "tune" / "tune_result.json",
}


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-standard JSON constant {name}")


def _load(path: Path) -> Any:
    assert path.is_file(), f"fixture missing: {path}"
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)


def _match(pattern: str, text: str, where: Path) -> re.Match[str]:
    found = re.search(pattern, text, flags=re.MULTILINE)
    assert found is not None, f"{where}: no match for {pattern!r}"
    return found


def _installed() -> tuple[int, int]:
    mm = major_minor(version("lizyml"))
    assert mm is not None
    return mm


# --- versions ------------------------------------------------------------------


def test_readme_records_the_installed_lizyml_minor() -> None:
    readme = FIXTURES / "README.md"
    line = _match(r"^- \*\*lizyml version\*\*: (\S+)$", readme.read_text(), readme)
    assert major_minor(line.group(1)) == _installed()


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_metadata_was_written_by_the_installed_lizyml_minor(scenario: str) -> None:
    metadata = _load(FIXTURES / scenario / "metadata.json")
    assert major_minor(metadata["lizyml_version"]) == _installed()


# --- config shape --------------------------------------------------------------


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_config_has_the_shape_the_ui_writes(scenario: str) -> None:
    config = _load(FIXTURES / scenario / "config.json")
    # No seed default (P-0116 D5): split and isotonic inherit training.seed.
    assert "random_state" not in config["split"]
    # Explicit-pick marker, never the deprecated ratio (D-20261020-008 A).
    early_stopping = config["training"]["early_stopping"]
    assert isinstance(early_stopping["inner_valid_explicit"], bool)
    assert "validation_ratio" not in early_stopping
    assert "embargo" not in config["split"]
    # The UI writes the task's whole reporting-metric option set.
    expected = _build_eval_metric_option_sets()[config["task"]]
    metrics = config["evaluation"]["metrics"]
    assert sorted(metrics) == sorted(expected)
    assert len(metrics) == len(expected)


def test_tune_config_omits_a_derived_direction() -> None:
    config = _load(FIXTURES / "tune" / "config.json")
    params = config["tuning"]["optuna"]["params"]
    assert "n_trials" in params
    assert "direction" not in params


# --- mirrors and hygiene -------------------------------------------------------


@pytest.mark.parametrize("mirror", sorted(MIRROR_OF), ids=lambda p: p.name)
def test_frontend_mirror_equals_its_backend_copy(mirror: Path) -> None:
    assert _load(mirror) == _load(MIRROR_OF[mirror])


def test_mirror_set_is_complete() -> None:
    assert sorted(MIRRORS.glob("*.json")) == sorted(MIRROR_OF)


@pytest.mark.parametrize(
    "path",
    [FIXTURES / s / f for s in SCENARIOS for f in FILES[s]] + sorted(MIRROR_OF),
    ids=lambda p: f"{p.parent.name}/{p.name}",
)
def test_fixture_is_strict_json_without_local_paths(path: Path) -> None:
    _load(path)
    text = path.read_text(encoding="utf-8")
    assert "/tmp/" not in text
    assert "/home/" not in text


# --- past lizyml minors --------------------------------------------------------


def _script_past_versions() -> list[str]:
    script = ROOT / "scripts" / "pickle_compat_matrix.sh"
    found = _match(
        r'^PAST_VERSIONS="\$\{PAST_VERSIONS:-([0-9. ]+)\}"$', script.read_text(), script
    )
    return found.group(1).split()


def _nightly_past_versions() -> list[str]:
    workflow = ROOT / ".github" / "workflows" / "nightly.yml"
    data = yaml.safe_load(workflow.read_text())
    values = [
        step["env"]["PAST_VERSIONS"]
        for job in data["jobs"].values()
        for step in job.get("steps", [])
        if "PAST_VERSIONS" in (step.get("env") or {})
    ]
    assert len(values) == 1, f"{workflow}: expected one PAST_VERSIONS, got {values}"
    return str(values[0]).split()


def _bench_past_versions() -> list[str]:
    bench = ROOT / "tests" / "bench" / "test_bench_pickle_compat.py"
    found = _match(r"^PAST_MINORS = \(([^)]*)\)$", bench.read_text(), bench)
    return re.findall(r'"([0-9.]+)"', found.group(1))


def test_past_versions_are_the_three_minors_below_the_installed_one() -> None:
    major, minor = _installed()
    expected = [f"{major}.{minor - k}.0" for k in (3, 2, 1)]
    assert _script_past_versions() == expected
    assert _nightly_past_versions() == expected
    assert _bench_past_versions() == expected
