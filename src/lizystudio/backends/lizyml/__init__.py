"""LizyML backend package.

H-0062 cleanup: the original ``lizyml.py`` module was split into a
package directory with focused submodules. This ``__init__`` re-exports
every public symbol that callers used prior to the split so existing
``from lizystudio.backends.lizyml import ...`` statements continue to
work without churn.

Public surface (frozen for backward compatibility):

- ``LizyMLAdapter`` -- the adapter class itself
- ``PicklePreflightError`` / ``PickleIncompatibleError`` -- raised from
  the checkpoint persistence path
- ``preflight_pickle_check`` / ``verify_pickle_compatibility`` --
  helpers exposed for the API layer's synchronous compatibility check

Internal symbols (``_serialize_*``, ``_parse_re_tune``,
``_task_params_compat_errors``) live on the submodules and should
*not* be imported from this package; their names also changed (lost
the leading underscore) when they moved into focused modules.
"""

from .adapter import LizyMLAdapter
from .pickle_compat import (
    PickleIncompatibleError,
    PicklePreflightError,
    preflight_pickle_check,
    verify_pickle_compatibility,
)

__all__ = [
    "LizyMLAdapter",
    "PickleIncompatibleError",
    "PicklePreflightError",
    "preflight_pickle_check",
    "verify_pickle_compatibility",
]
