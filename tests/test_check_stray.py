"""Tests for scripts/check_stray.sh (block-stray-artifacts pre-commit hook).

The hook reads ``git diff --cached`` and exits non-zero when the staged set
contains scratch/build artefacts. These tests build a throwaway git repo,
stage representative files with ``git add -f`` (mirroring the bypass the hook
exists to catch), and assert the exit code.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_stray.sh"


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A minimal git repo with one committed file."""
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init", "-q")
    _git(r, "config", "user.email", "test@example.com")
    _git(r, "config", "user.name", "test")
    (r / "README.md").write_text("hello\n")
    _git(r, "add", "README.md")
    _git(r, "commit", "-qm", "init")
    return r


def _run_hook(repo: Path) -> int:
    return subprocess.run(
        ["bash", str(SCRIPT)], cwd=repo, capture_output=True
    ).returncode


def _stage(repo: Path, rel: str) -> None:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"")
    _git(repo, "add", "-f", rel)


@pytest.mark.parametrize(
    "rel",
    [
        "dist/lizystudio-9.9.9-py3-none-any.whl",
        "dist/lizystudio-9.9.9.tar.gz",
        "spike-debug.png",  # root-level PNG
        "scratch.csv",  # root-level CSV
        "out.parquet",  # root-level parquet
        "coverage.json",
        ".coverage",
        "subpkg/coverage.json",
        "build.tsbuildinfo",
    ],
)
def test_blocks_stray_artifact(repo: Path, rel: str) -> None:
    _stage(repo, rel)
    assert _run_hook(repo) == 1, f"expected {rel} to be blocked"


@pytest.mark.parametrize(
    "rel",
    [
        "docs/images/diagram.png",
        "tests/fixtures/lizyml/scenario/fit_result.json",
        "tests/fixtures/sample.csv",
        "frontend/src/__fixtures__/lizyml/fit.json",
        "frontend/tests/e2e/__screenshots__/chromium/visual/x.png",
        "data/demo/train.csv",
        "src/lizystudio/api/new_router.py",
        "docs/some-note.md",
        "nested/dir/module.png",  # PNG but not at repo root → allowed by this hook
    ],
)
def test_allows_legit_file(repo: Path, rel: str) -> None:
    _stage(repo, rel)
    assert _run_hook(repo) == 0, f"expected {rel} to be allowed"


def test_clean_index_passes(repo: Path) -> None:
    assert _run_hook(repo) == 0


def test_blocks_only_offending_file_in_mixed_stage(repo: Path) -> None:
    _stage(repo, "src/lizystudio/ok.py")
    _stage(repo, "dist/bad-1.0.0-py3-none-any.whl")
    assert _run_hook(repo) == 1
