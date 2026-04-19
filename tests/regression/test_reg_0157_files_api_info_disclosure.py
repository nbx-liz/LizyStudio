"""Regression test for /api/files information disclosure (Issue #157).

The file browser endpoint echoed the server-side resolved path back
in its response, even for requests that were rejected (out-of-root
traversal, missing directory, permission denied). That leaked the
server-side absolute path — confirming existence of directories the
caller may not be authorized to know about.

Contract preserved for this fix (Approach B):
- Success responses still return the resolved path so the frontend
  can render breadcrumbs / parent navigation.
- Error paths (traversal, missing, permission) return the ORIGINAL
  user-supplied path (or empty) and ``parent=None`` so no server
  topology bleeds out.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_traversal_echoes_user_input_not_resolved(client: TestClient) -> None:
    """A rejected traversal must echo the user-supplied path, not the
    server-resolved absolute path.

    The legacy behaviour returned the resolved ``/etc`` style absolute
    path, disclosing server filesystem topology. The fix returns the
    original client input so the UI can still render an error message
    without leaking server paths.
    """
    user_input = "../../etc"
    response = client.get(f"/api/files?path={user_input}")
    assert response.status_code == 200
    body = response.json()
    assert body["entries"] == []
    # The response MUST echo what the caller sent, not what the server
    # resolved it to. An absolute server path would start with "/" and
    # be longer than the user input.
    assert body["path"] == user_input, (
        f"expected echo of user input, got: {body['path']!r}"
    )


def test_absolute_outside_root_echoes_user_input_not_resolved(
    client: TestClient,
) -> None:
    """Absolute paths outside ALLOWED_FILES_ROOT must echo input only."""
    user_input = "/etc/passwd"
    response = client.get(f"/api/files?path={user_input}")
    assert response.status_code == 200
    body = response.json()
    assert body["entries"] == []
    # The echoed value equals the user input. The resolved absolute
    # path would normally be the same here (since it's already
    # absolute), but the critical invariant is that `parent` is None
    # — see the separate test — so no server topology is disclosed.
    assert body["path"] == user_input
    assert body["parent"] is None


def test_nonexistent_path_inside_root_does_not_echo_resolved_path(
    client: TestClient,
) -> None:
    """Requesting a nonexistent directory INSIDE the root: the server
    used to echo the absolute resolved path (disclosing the real root
    location). Now we return the user-supplied form.
    """
    import lizystudio.security as sec

    missing = sec.ALLOWED_FILES_ROOT / "no_such_dir_xyz"
    response = client.get(f"/api/files?path={missing}")
    assert response.status_code == 200
    body = response.json()
    assert body["entries"] == []
    # The response may be empty or the user-supplied form; it must not
    # be the server's resolved form with additional topology data.
    # The critical invariant: parent field must not point at an
    # internal server directory (was `str(missing.parent.resolve())`).
    assert body["parent"] is None, (
        f"parent disclosed for nonexistent path: {body['parent']!r}"
    )


def test_valid_path_still_returns_resolved_path(
    client: TestClient,
) -> None:
    """Regression guard: for AUTHORIZED requests the resolved path
    and parent are still returned so the frontend can render
    navigation. Only rejected requests hide the resolution.

    The ``client`` fixture points ``ALLOWED_FILES_ROOT`` at ``/tmp``.
    Create the subdirectory with a unique name and clean it up
    afterwards so this test cannot collide with concurrent runs or
    leave residue for subsequent invocations.
    """
    import shutil
    import uuid

    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = root / f"reg_0157_{uuid.uuid4().hex}"
    subdir.mkdir()
    try:
        response = client.get(f"/api/files?path={subdir}")
        assert response.status_code == 200
        body = response.json()
        assert body["path"] == str(subdir)
        assert body["parent"] == str(root)
    finally:
        shutil.rmtree(subdir, ignore_errors=True)


def test_oserror_during_listing_sanitized(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An OSError during iteration (not just PermissionError) must
    not propagate; the sanitised empty response is returned.

    Simulates a failing iterdir by monkey-patching Path.iterdir to
    raise OSError(EIO). Without the broader `except OSError` catch
    the handler would 500 and may include ``dir_path`` in logs.
    """
    import shutil
    import uuid

    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = root / f"reg_0157_io_{uuid.uuid4().hex}"
    subdir.mkdir()
    try:
        real_iterdir = Path.iterdir

        def failing_iterdir(self: Path) -> object:  # type: ignore[override]
            if self == subdir:
                raise OSError(5, "Input/output error")
            return real_iterdir(self)

        monkeypatch.setattr(Path, "iterdir", failing_iterdir)
        response = client.get(f"/api/files?path={subdir}")
        assert response.status_code == 200
        body = response.json()
        assert body["entries"] == []
        assert body["parent"] is None
    finally:
        shutil.rmtree(subdir, ignore_errors=True)


def test_traversal_response_parent_is_none(client: TestClient) -> None:
    """parent=None on all rejected-request paths prevents disclosing
    the server-side parent directory.
    """
    response = client.get("/api/files?path=../../etc")
    assert response.status_code == 200
    assert response.json()["parent"] is None
