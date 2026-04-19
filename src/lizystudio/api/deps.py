"""Central FastAPI dependency factories (coupling-analysis A-8).

Every router that needs a shared server-lifetime object obtains it
through one of the `Depends(get_*)` helpers defined here rather than
reaching for `request.app.state.*` directly.  This gives the test
suite a single seam to patch, makes the router signatures self-
documenting, and eliminates the duplicate `_get_broadcaster` helpers
that used to live in both `api/workspace.py` and `api/retune.py`.

The existing `get_workspace` / `get_job_store` helpers defined in the
service layer are re-exported here so that routers only need to import
from a single location.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.requests import HTTPConnection

from lizystudio.services.jobs import get_job_store
from lizystudio.services.workspace import get_workspace

if TYPE_CHECKING:
    from lizystudio.backends.base import BackendAdapter
    from lizystudio.ws.progress import ProgressBroadcaster


__all__ = [
    "get_backend",
    "get_broadcaster",
    "get_job_store",
    "get_workspace",
]


# ``HTTPConnection`` is the common base class of Starlette's ``Request``
# (HTTP) and ``WebSocket``; using it as the annotation lets a single
# factory satisfy both ``Depends(...)`` resolutions — FastAPI injects
# the live ``Request`` on HTTP routes and the live ``WebSocket`` on
# ``@app.websocket`` handlers, and both expose ``.app.state``.


def get_broadcaster(connection: HTTPConnection) -> ProgressBroadcaster:
    """Return the process-wide :class:`ProgressBroadcaster`.

    Populated by the application lifespan in :func:`lizystudio.server.create_app`.
    Works for both HTTP and WebSocket handlers because both pass an
    :class:`HTTPConnection` subclass.
    """
    return connection.app.state.broadcaster  # type: ignore[no-any-return]


def get_backend(connection: HTTPConnection) -> BackendAdapter:
    """Return the active :class:`BackendAdapter` bound to the workspace.

    Convenience factory so endpoints that only need the adapter do not
    have to depend on the whole :class:`WorkspaceState`.
    """
    return connection.app.state.workspace.backend  # type: ignore[no-any-return]
