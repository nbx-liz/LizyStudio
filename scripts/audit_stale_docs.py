#!/usr/bin/env python3
"""Stale-doc audit — #456 L5 / Issue #495.

Lists plan-class / handoff / readiness / audit documents that are both:

  (a) older than the staleness threshold (last commit > 30 days ago), and
  (b) not referenced from any of the spec / index files
      (BLUEPRINT.md, HISTORY.md, PLAN.md, CHANGELOG.md, README.md,
       docs/ROADMAP.md, .claude/AGENTS.md).

The script is layered for testability:

  ``audit(repo)`` returns a list of ``StaleDoc`` records.
  ``main()`` formats those records as Markdown to stdout for the
  ``audit-stale-docs.yml`` workflow to fold into a tracking Issue.

Failure mode covered: M3 from #456 -- rot of plan-class artefacts that
no spec doc references. L1 (``tmp/`` convention), L2 (``block-stray-artifacts``
hook), L3 (orphan-golden gate), L4 (CI checks) do not catch this class.

Exit code is always 0 -- the workflow uses the stdout payload to update
the tracking Issue; it never fails the build on stale docs alone.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Globs whose ``docs/<file>.md`` matches will be considered candidates.
# Patterns are relative to the repo root.
#
# Both ``docs/handoff-*.md`` (no prefix) and ``docs/*-handoff-*.md`` (versioned
# prefix) shapes appear in the tree — see ``docs/handoff-2026-05-10-...md``
# vs hypothetical ``docs/v05-handoff-*.md`` — so both are listed.
CANDIDATE_GLOBS: tuple[str, ...] = (
    "docs/handoff-*.md",
    "docs/*-handoff-*.md",
    "docs/readiness-*.md",
    "docs/*-readiness-*.md",
    "docs/audit-*.md",
    "docs/*-audit-*.md",
    "docs/v*-prep-*.md",
    "docs/v*-handoff-*.md",
)

# Files that, if they reference a candidate doc, mark it as still
# load-bearing and exempt it from the audit.
INDEX_FILES: tuple[str, ...] = (
    "BLUEPRINT.md",
    "HISTORY.md",
    "PLAN.md",
    "CHANGELOG.md",
    "README.md",
    "docs/ROADMAP.md",
    ".claude/AGENTS.md",
)

DEFAULT_STALE_DAYS = 30


@dataclass(frozen=True)
class StaleDoc:
    """One audit hit -- a doc that meets both staleness criteria."""

    path: str  # relative to repo root
    last_touched: datetime  # UTC, from ``git log -1 --format=%cI``
    line_count: int


def _git_last_touched(repo: Path, rel_path: str) -> datetime | None:
    """Return the UTC datetime of the most recent commit touching ``rel_path``.

    Returns ``None`` when the file is untracked.
    """
    result = subprocess.run(
        ["git", "log", "-1", "--format=%cI", "--", rel_path],
        cwd=repo,
        check=False,
        capture_output=True,
        text=True,
    )
    stamp = result.stdout.strip()
    if not stamp:
        return None
    # ``%cI`` is strict ISO-8601 (e.g. ``2026-05-23T12:34:56+00:00``).
    dt = datetime.fromisoformat(stamp)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _line_count(repo: Path, rel_path: str) -> int:
    p = repo / rel_path
    if not p.exists():
        return 0
    return sum(1 for _ in p.open("rb"))


def _iter_candidates(repo: Path) -> Iterable[str]:
    """Yield candidate doc paths matching the audit globs."""
    seen: set[str] = set()
    for pattern in CANDIDATE_GLOBS:
        for path in repo.glob(pattern):
            if not path.is_file():
                continue
            rel = path.relative_to(repo).as_posix()
            if rel in seen:
                continue
            seen.add(rel)
            yield rel


def _is_referenced(repo: Path, rel_path: str) -> bool:
    """Return True when any INDEX_FILES mentions ``rel_path`` verbatim.

    Matching is a substring search on the basename and on the full path.
    The basename match catches link-style references like
    ``[handoff](handoff-2026-05-10-post-h0079.md)`` from inside ``docs/``;
    the full-path match catches references from ``BLUEPRINT.md`` etc.
    """
    basename = Path(rel_path).name
    for index_rel in INDEX_FILES:
        p = repo / index_rel
        if not p.exists():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if rel_path in text or basename in text:
            return True
    return False


def audit(repo: Path, *, stale_days: int = DEFAULT_STALE_DAYS) -> list[StaleDoc]:
    """Return the list of candidate docs that are stale AND unreferenced."""
    now = datetime.now(tz=timezone.utc)
    threshold = now - timedelta(days=stale_days)
    hits: list[StaleDoc] = []
    for rel in sorted(_iter_candidates(repo)):
        last = _git_last_touched(repo, rel)
        if last is None or last > threshold:
            continue
        if _is_referenced(repo, rel):
            continue
        hits.append(
            StaleDoc(path=rel, last_touched=last, line_count=_line_count(repo, rel))
        )
    return hits


def render_markdown(
    hits: list[StaleDoc], *, stale_days: int = DEFAULT_STALE_DAYS
) -> str:
    """Render the audit result as a Markdown report for the tracking Issue."""
    title = (
        f"# Stale handoff / readiness / audit docs ({stale_days}+ days unreferenced)"
    )
    header = (
        f"{title}\n\n"
        "Generated by `scripts/audit_stale_docs.py` (cron via "
        "`.github/workflows/audit-stale-docs.yml`).\n\n"
        "Each entry below is older than the staleness threshold **and** is not "
        "referenced from any of: `BLUEPRINT.md`, `HISTORY.md`, `PLAN.md`, "
        "`CHANGELOG.md`, `README.md`, `docs/ROADMAP.md`, `.claude/AGENTS.md`.\n\n"
        "**Action**: delete the doc unless it is still load-bearing; if it is, "
        "add a reference from one of the index files above.\n\n"
    )
    if not hits:
        return header + "_No stale docs detected._\n"
    lines = ["| Path | Last touched | Lines |", "|---|---|---|"]
    for hit in hits:
        date = hit.last_touched.date().isoformat()
        lines.append(f"| `{hit.path}` | {date} | {hit.line_count} |")
    return header + "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        default=".",
        help="Repository root (default: cwd).",
    )
    parser.add_argument(
        "--stale-days",
        type=int,
        default=DEFAULT_STALE_DAYS,
        help=f"Staleness threshold in days (default: {DEFAULT_STALE_DAYS}).",
    )
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()
    hits = audit(repo, stale_days=args.stale_days)
    sys.stdout.write(render_markdown(hits, stale_days=args.stale_days))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
