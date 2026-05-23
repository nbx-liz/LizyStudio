"""Tests for scripts/audit_stale_docs.py (#456 L5 / Issue #495).

The script lists plan-class / handoff / readiness / audit docs that are
both stale (last commit > 30 days ago) AND unreferenced from any of the
spec / index files. These tests build throwaway git repos with controlled
file ages (via ``GIT_AUTHOR_DATE`` / ``GIT_COMMITTER_DATE``) and assert
the audit output.
"""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit_stale_docs.py"


def _git(repo: Path, *args: str, env: dict[str, str] | None = None) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, env=env)


def _commit_at(repo: Path, *, days_ago: int, message: str) -> None:
    """Stage everything and commit with author/committer date ``days_ago``."""
    stamp = (datetime.now(tz=timezone.utc) - timedelta(days=days_ago)).strftime(
        "%Y-%m-%dT%H:%M:%S+0000"
    )
    import os

    env = os.environ.copy()
    env["GIT_AUTHOR_DATE"] = stamp
    env["GIT_COMMITTER_DATE"] = stamp
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", message, env=env)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A minimal git repo seeded with empty index files."""
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init", "-q", "-b", "main")
    _git(r, "config", "user.email", "test@example.com")
    _git(r, "config", "user.name", "test")
    # Seed the index files the audit consults.
    for rel in (
        "BLUEPRINT.md",
        "HISTORY.md",
        "PLAN.md",
        "CHANGELOG.md",
        "README.md",
        "docs/ROADMAP.md",
        ".claude/AGENTS.md",
    ):
        p = r / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("# index\n")
    _commit_at(r, days_ago=60, message="seed index files")
    return r


def _run(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--repo", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
    )


def _add_doc(repo: Path, rel: str, *, days_ago: int, body: str = "stub\n") -> None:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body)
    _commit_at(repo, days_ago=days_ago, message=f"add {rel}")


def test_empty_repo_reports_no_hits(repo: Path) -> None:
    """No candidate docs => clean report, exit 0."""
    result = _run(repo)
    assert result.returncode == 0
    assert "No stale docs detected." in result.stdout


def test_fresh_doc_is_excluded(repo: Path) -> None:
    """A doc touched within the threshold (< 30 days) is not stale."""
    _add_doc(repo, "docs/handoff-recent.md", days_ago=5)
    result = _run(repo)
    assert result.returncode == 0
    assert "handoff-recent" not in result.stdout
    assert "No stale docs detected." in result.stdout


def test_stale_unreferenced_doc_is_flagged(repo: Path) -> None:
    """A > 30-day-old, unreferenced handoff doc appears in the report."""
    _add_doc(repo, "docs/handoff-2026-01-01.md", days_ago=60)
    result = _run(repo)
    assert result.returncode == 0
    assert "docs/handoff-2026-01-01.md" in result.stdout


def test_stale_doc_referenced_from_roadmap_is_excluded(repo: Path) -> None:
    """A stale doc referenced from ``docs/ROADMAP.md`` is still load-bearing."""
    _add_doc(repo, "docs/handoff-2026-01-02.md", days_ago=60)
    (repo / "docs" / "ROADMAP.md").write_text(
        "see `docs/handoff-2026-01-02.md` for context\n"
    )
    _commit_at(repo, days_ago=60, message="ref handoff from roadmap")
    result = _run(repo)
    assert result.returncode == 0
    assert "handoff-2026-01-02" not in result.stdout


def test_basename_reference_counts(repo: Path) -> None:
    """A basename-only mention (e.g. from a sibling doc) marks load-bearing."""
    _add_doc(repo, "docs/handoff-2026-01-03.md", days_ago=60)
    # BLUEPRINT.md references the basename only.
    (repo / "BLUEPRINT.md").write_text("links to handoff-2026-01-03.md\n")
    _commit_at(repo, days_ago=60, message="basename ref")
    result = _run(repo)
    assert result.returncode == 0
    assert "handoff-2026-01-03" not in result.stdout


def test_audit_pattern_glob_handoff_readiness_audit_prep(repo: Path) -> None:
    """All four declared glob patterns are honoured."""
    _add_doc(repo, "docs/handoff-x.md", days_ago=60)
    _add_doc(repo, "docs/v05-readiness-x.md", days_ago=60)
    _add_doc(repo, "docs/some-audit-x.md", days_ago=60)
    _add_doc(repo, "docs/v05-prep-x.md", days_ago=60)
    # A non-matching doc must NOT appear.
    _add_doc(repo, "docs/architecture-notes.md", days_ago=60)
    result = _run(repo)
    assert result.returncode == 0
    for path in (
        "docs/handoff-x.md",
        "docs/v05-readiness-x.md",
        "docs/some-audit-x.md",
        "docs/v05-prep-x.md",
    ):
        assert path in result.stdout
    assert "architecture-notes" not in result.stdout


def test_line_count_is_emitted(repo: Path) -> None:
    """Output table includes line count for prioritisation."""
    _add_doc(
        repo,
        "docs/handoff-multi.md",
        days_ago=60,
        body="line1\nline2\nline3\n",
    )
    result = _run(repo)
    assert result.returncode == 0
    # The table renders ``| 3 |`` for a 3-line file.
    assert "| 3 |" in result.stdout


def test_custom_stale_days_threshold(repo: Path) -> None:
    """``--stale-days=7`` flags a 14-day-old doc that 30-day default would skip."""
    _add_doc(repo, "docs/handoff-mid.md", days_ago=14)
    # 30-day default: not stale
    result_default = _run(repo)
    assert "handoff-mid" not in result_default.stdout
    # 7-day threshold: stale
    result_strict = _run(repo, "--stale-days", "7")
    assert "handoff-mid" in result_strict.stdout
