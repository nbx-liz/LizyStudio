"""Contract: every method name cited in ``docs/adapter-guide.md`` must exist
on ``BackendAdapter`` (the Protocol that documents itself).

The Tier 3 reference docs (`docs/architecture.md`, `docs/api.md`,
`docs/adapter-guide.md`) are derived from BLUEPRINT and the implementation;
they drift when refactors rename a method, add a new one, or split the
Protocol (H-0068 split into BackendCore / BackendEvaluation / etc.).

This test parses every code block in `adapter-guide.md`, extracts the
``def <name>(`` signatures, and asserts each name is reachable on the
runtime-checkable ``BackendAdapter`` Protocol. It does NOT compare full
signatures — that would be too brittle against minor parameter renames.
The contract is "names cited in the doc must exist", not "signatures
match byte-for-byte".

Adding a new method to BackendAdapter? Document it in adapter-guide.md
in the next PR. Renaming an existing one? This test fails first and
forces the doc update.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from lizystudio.backends.base import BackendAdapter

pytestmark = pytest.mark.unit


_ADAPTER_GUIDE = (
    Path(__file__).resolve().parent.parent.parent / "docs" / "adapter-guide.md"
)


# Exclude method names that the doc cites for the *user's* adapter class
# (e.g. step-by-step examples), generic Python dunders, or well-known
# stdlib names that are not part of the BackendAdapter Protocol.
_EXCLUDED_NAMES = frozenset(
    {
        # generic Python / unrelated context
        "__call__",  # ProgressCallback signature
        "on_progress",  # ProgressCallback name in user-side examples
    }
)


def _extract_def_names(markdown: str) -> set[str]:
    """Return the set of ``def <name>`` identifiers in fenced code blocks."""
    in_block = False
    names: set[str] = set()
    pattern = re.compile(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
    for line in markdown.splitlines():
        if line.lstrip().startswith("```"):
            in_block = not in_block
            continue
        if not in_block:
            continue
        m = pattern.match(line)
        if m:
            names.add(m.group(1))
    return names


def test_adapter_guide_exists() -> None:
    assert _ADAPTER_GUIDE.is_file(), (
        f"docs/adapter-guide.md missing at {_ADAPTER_GUIDE}"
    )


def test_every_method_name_in_doc_exists_on_protocol() -> None:
    """All ``def <name>`` from adapter-guide code blocks must be present on
    BackendAdapter (or be in the excluded list of unrelated/example names)."""
    text = _ADAPTER_GUIDE.read_text(encoding="utf-8")
    names = _extract_def_names(text)
    assert names, "adapter-guide.md should contain at least one def example"

    protocol_attrs = set(dir(BackendAdapter))
    missing: list[str] = []
    for name in sorted(names - _EXCLUDED_NAMES):
        if name not in protocol_attrs:
            missing.append(name)

    assert not missing, (
        "adapter-guide.md cites method name(s) that do not exist on the "
        "BackendAdapter Protocol — either the doc has drifted (rename / "
        "removed method) or this test's _EXCLUDED_NAMES needs an entry "
        f"for an unrelated example: {missing}"
    )


def test_core_lifecycle_methods_are_documented() -> None:
    """The doc must mention the four canonical lifecycle method names so a
    contributor can find them quickly. This is the load-bearing minimum;
    the broader exhaustive coverage is enforced by the symmetric direction
    above."""
    text = _ADAPTER_GUIDE.read_text(encoding="utf-8")
    names = _extract_def_names(text)
    required = {"fit", "tune", "predict", "create_model"}
    missing_in_doc = required - names
    assert not missing_in_doc, (
        f"adapter-guide.md should keep `def` examples for the core "
        f"lifecycle methods; missing from doc: {sorted(missing_in_doc)}"
    )
