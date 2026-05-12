"""Tests for scripts/check_orphan_goldens.sh (#456 L3 orphan-visual-golden gate).

The script fails when a committed Playwright golden lives under a project dir
that no workflow under .github/workflows/ exercises via ``--project=<dir>``.
These tests build throwaway git repos with various golden / workflow layouts
and assert the exit code.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_orphan_goldens.sh"
GOLDEN_ROOT = "frontend/tests/e2e/__screenshots__"


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def _write(repo: Path, rel: str, content: str = "") -> None:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init", "-q")
    _git(r, "config", "user.email", "test@example.com")
    _git(r, "config", "user.name", "test")
    _write(r, "README.md", "x\n")
    _git(r, "add", "-A")
    _git(r, "commit", "-qm", "init")
    return r


def _run(repo: Path) -> int:
    return subprocess.run(
        ["bash", str(SCRIPT)], cwd=repo, capture_output=True
    ).returncode


def _commit_layout(
    repo: Path, *, golden_projects: list[str], ci_projects: list[str]
) -> None:
    for proj in golden_projects:
        _write(repo, f"{GOLDEN_ROOT}/{proj}/visual/spec.spec.ts/snap.png", "")
    proj_args = " ".join(f"--project={p}" for p in ci_projects)
    _write(
        repo,
        ".github/workflows/ci.yml",
        f"jobs:\n  e2e:\n    run: playwright test {proj_args}\n",
    )
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "layout")


def test_no_goldens_passes(repo: Path) -> None:
    _write(repo, ".github/workflows/ci.yml", "jobs: {}\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "no goldens")
    assert _run(repo) == 0


def test_golden_with_matching_project_passes(repo: Path) -> None:
    _commit_layout(repo, golden_projects=["chromium"], ci_projects=["chromium"])
    assert _run(repo) == 0


def test_multiple_goldens_all_covered_passes(repo: Path) -> None:
    _commit_layout(
        repo,
        golden_projects=["chromium", "chromium-tablet"],
        ci_projects=["chromium", "chromium-tablet", "firefox"],
    )
    assert _run(repo) == 0


def test_orphan_golden_fails(repo: Path) -> None:
    # chromium-mobile golden committed but no workflow runs --project=chromium-mobile
    _commit_layout(
        repo,
        golden_projects=["chromium", "chromium-mobile"],
        ci_projects=["chromium"],
    )
    assert _run(repo) == 1


def test_orphan_resolved_when_workflow_added(repo: Path) -> None:
    _commit_layout(
        repo,
        golden_projects=["chromium-mobile"],
        ci_projects=["chromium"],
    )
    assert _run(repo) == 1
    # add the missing --project= ref → green
    _write(
        repo,
        ".github/workflows/nightly.yml",
        "jobs:\n  visual:\n    run: playwright test --project=chromium-mobile\n",
    )
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "add mobile project to nightly")
    assert _run(repo) == 0


def test_orphan_resolved_when_golden_removed(repo: Path) -> None:
    _commit_layout(
        repo,
        golden_projects=["chromium", "chromium-mobile"],
        ci_projects=["chromium"],
    )
    assert _run(repo) == 1
    subprocess.run(
        ["git", "rm", "-rq", f"{GOLDEN_ROOT}/chromium-mobile"],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    _git(repo, "commit", "-qm", "drop orphan goldens")
    assert _run(repo) == 0
