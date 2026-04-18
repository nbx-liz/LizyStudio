"""Regression test for case-sensitive path validation (Issue #155).

``validate_path_within`` used ``str(resolved).startswith(str(root))``
— a pure string comparison. On case-insensitive filesystems
(HFS+/APFS on macOS, NTFS on Windows), ``Path.resolve()`` preserves
the caller-supplied case, so a mixed-case request resolves without
case folding and fails ``startswith(root)`` even though the OS
would serve the same file.

The fix uses ``Path.is_relative_to`` so containment is judged by
path semantics (normalisation of separators, drive letters, etc.)
rather than raw string bytes. We also switch ``validate_static_path``
to the same API to keep both code paths consistent.

## Invariants

- Traversal rejection: ``../`` attempts still raise ``ValueError``
  (unchanged contract).
- Boundary preservation: a path that is prefix-similar but NOT
  under the root (e.g. ``/tmp/root2`` against root ``/tmp/root``)
  is rejected.
- Root itself is accepted (edge case of ``is_relative_to`` matching
  the root directory).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from lizystudio.security import validate_path_within, validate_static_path

pytestmark = pytest.mark.unit


def test_path_equal_to_root_is_accepted(tmp_path: Path) -> None:
    """Boundary: the root directory itself validates successfully."""
    resolved = validate_path_within(tmp_path, tmp_path)
    assert resolved == tmp_path.resolve()


def test_nested_path_is_accepted(tmp_path: Path) -> None:
    """A legitimate descendant validates successfully."""
    inner = tmp_path / "sub" / "file.csv"
    inner.parent.mkdir(parents=True)
    inner.touch()
    resolved = validate_path_within(inner, tmp_path)
    assert resolved == inner.resolve()


def test_prefix_similar_sibling_is_rejected(tmp_path: Path) -> None:
    """INV: prefix-similarity is NOT containment.

    ``/tmp/root`` must not accept ``/tmp/root2/foo`` even though the
    string starts with the same characters. This guards against the
    legacy ``startswith`` bug where ``root`` + ``2`` trivially passed.
    """
    root = tmp_path / "root"
    root.mkdir()
    sibling = tmp_path / "root2"
    sibling.mkdir()
    target = sibling / "foo.txt"
    target.touch()
    with pytest.raises(ValueError):
        validate_path_within(target, root)


def test_parent_traversal_is_rejected(tmp_path: Path) -> None:
    """INV: ../ traversal still raises ValueError."""
    root = tmp_path / "root"
    root.mkdir()
    # A path under tmp_path but outside `root`.
    outside = tmp_path / "elsewhere.txt"
    outside.touch()
    with pytest.raises(ValueError):
        validate_path_within(outside, root)


def test_validate_static_path_accepts_file_in_root(tmp_path: Path) -> None:
    """validate_static_path returns the resolved file path for valid input."""
    f = tmp_path / "index.html"
    f.write_text("<html></html>", encoding="utf-8")
    result = validate_static_path(f, tmp_path)
    assert result == f.resolve()


def test_validate_static_path_rejects_prefix_sibling(tmp_path: Path) -> None:
    """Regression for the same string-prefix bug in validate_static_path."""
    root = tmp_path / "static"
    root.mkdir()
    sibling = tmp_path / "static2"
    sibling.mkdir()
    impostor = sibling / "leak.html"
    impostor.write_text("x", encoding="utf-8")
    assert validate_static_path(impostor, root) is None


def test_validate_static_path_rejects_nonfile(tmp_path: Path) -> None:
    """A directory inside the root is not a valid static resource."""
    root = tmp_path / "static"
    root.mkdir()
    d = root / "subdir"
    d.mkdir()
    assert validate_static_path(d, root) is None
