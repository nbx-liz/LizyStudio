"""Turn captured jobs into the lizyml production fixtures (P-0116 child 8).

Reads the manifest ``frontend/tests/fixture-capture/capture.spec.ts`` wrote
(``{scenario: job_id}``) and the jobs directory the capture server used, then
writes, per scenario, ``tests/fixtures/lizyml/<scenario>/``:

* ``config.json``   — the job's config (``meta.json``), local paths scrubbed;
* ``fit_result.json``;
* ``metadata.json`` — ``model/metadata.json``, local paths scrubbed;
* ``tune_result.json`` — Tune scenarios only, scrubbed;

and mirrors ``fit_result.json`` / ``tune_result.json`` into
``frontend/src/__fixtures__/lizyml/``.  ``data.csv`` is never touched: the
capture reads it, other fixtures depend on its bytes.

Usage::

    uv run python scripts/export_lizyml_fixtures.py <jobs_dir> <manifest.json>

Fails on a missing scenario, a job that did not complete, a non-standard
JSON constant, or a local path left after scrubbing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "lizyml"
MIRRORS = ROOT / "frontend" / "src" / "__fixtures__" / "lizyml"
SCENARIOS = ("binary_no_cal", "binary_isotonic", "regression", "tune")
TUNE_SCENARIOS = ("tune",)

_DATA_KEYS = ("path", "data_path")
_DIR_KEYS = ("output_dir", "model_path", "model_dir")
_LOCAL_PREFIXES = ("/tmp/", "/home/")


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-standard JSON constant {name}")


def _read(path: Path) -> Any:
    if not path.is_file():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)


def scrub(value: Any) -> Any:
    """Replace local paths with placeholders and drop the compiler suffix."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if (
                key in _DATA_KEYS
                and isinstance(item, str)
                and item.startswith(_LOCAL_PREFIXES)
            ):
                out[key] = "/path/to/data.csv"
            elif key in _DIR_KEYS and isinstance(item, str) and item.startswith("/"):
                out[key] = "/path/to/output_dir"
            elif key == "python_version" and isinstance(item, str) and " [" in item:
                out[key] = item.split(" [")[0]
            else:
                out[key] = scrub(item)
        return out
    if isinstance(value, list):
        return [scrub(item) for item in value]
    return value


def _write(path: Path, data: Any) -> None:
    text = json.dumps(data, indent=2, allow_nan=False) + "\n"
    for prefix in _LOCAL_PREFIXES:
        if prefix in text:
            raise ValueError(f"{path}: {prefix} left after scrubbing")
    path.write_text(text, encoding="utf-8")


def export(jobs_dir: Path, manifest: dict[str, str]) -> None:
    missing = [s for s in SCENARIOS if s not in manifest]
    if missing:
        raise KeyError(f"manifest lacks scenarios {missing}")
    for scenario in SCENARIOS:
        job = jobs_dir / manifest[scenario]
        meta = _read(job / "meta.json")
        if meta["status"] != "completed":
            raise ValueError(f"{job}: status {meta['status']}")
        out = FIXTURES / scenario
        _write(out / "config.json", scrub(meta["config"]))
        fit_result = _read(job / "fit_result.json")
        _write(out / "fit_result.json", fit_result)
        _write(out / "metadata.json", scrub(_read(job / "model" / "metadata.json")))
        _write(MIRRORS / f"fit_result_{scenario}.json", fit_result)
        if scenario in TUNE_SCENARIOS:
            tune_result = scrub(_read(job / "tune_result.json"))
            _write(out / "tune_result.json", tune_result)
            _write(MIRRORS / f"tune_result_{scenario}.json", tune_result)


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        raise SystemExit("usage: export_lizyml_fixtures.py <jobs_dir> <manifest.json>")
    export(Path(argv[0]), _read(Path(argv[1])))


if __name__ == "__main__":
    main(sys.argv[1:])
