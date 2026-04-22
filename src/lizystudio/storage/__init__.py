"""Storage-layer helpers for versioned JSON artefacts (C-9 / H-0081).

This package centralises the on-disk persistence format. All JSON
files written by the services layer go through
:func:`~lizystudio.storage.versions.write_versioned_json` so the
current ``format_version`` is embedded consistently, and read back via
:func:`~lizystudio.storage.versions.read_versioned_json` so missing or
older versions run through the migration pipeline rather than silently
loading inconsistent state.

The ``model_meta.json`` checkpoint sidecar is intentionally **not**
routed through this module — its backend-specific ``pickle_schema``
field is a separate contract covered by
:mod:`lizystudio.backends.lizyml.pickle_compat` (H-0068).
"""

from __future__ import annotations

from lizystudio.storage.versions import (
    STUDIO_FORMAT_VERSION,
    read_versioned_json,
    write_versioned_json,
)

__all__ = [
    "STUDIO_FORMAT_VERSION",
    "read_versioned_json",
    "write_versioned_json",
]
