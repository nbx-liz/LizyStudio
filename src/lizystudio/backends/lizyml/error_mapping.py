"""The one place lizyml's coded errors become Studio refusals (P-0117 D2).

lizyml raises :class:`lizyml.core.exceptions.LizyMLError` with a ``code``
and a structured ``context``.  :data:`RULES` classifies them, first match
wins:

* **input** -- the user's data cannot be used (a column name an
  export_code project cannot hold, a category value a saved model cannot
  hold, a data schema refusal naming a column).  Raised as
  :class:`BackendInputError`; the API answers 400.
* **artifact** -- a stored model cannot be read, in one of the shapes the
  table names from a real lizyml raise site: an unknown or malformed
  category identity marker, a pickle whose checksum is not the recorded
  one, a ``format_version`` lizyml does not read.  Raised as
  :class:`BackendArtifactError`; the API answers 409.  Any other load
  failure (an I/O error naming only the ``file``, a missing directory, a
  shape the table does not know) stays in the last class.
* **everything else** -- every other error, including any code or context
  shape this table does not know.  It propagates unchanged, so the API
  keeps answering 500 ``BACKEND_ERROR`` and the narrow translations of
  P-0116 (``REFIT_REQUIRED``, ``TUNING_FAILED``, ``SEARCH_SPACE_REFUSED``)
  keep their own codes.  :func:`classify` still names its code and reason,
  and the adapter logs them, so a new lizyml reason is never silent.

Rules match on the code *and* on the context's shape, never on the code
alone: a ``SERIALIZATION_FAILED`` about an I/O failure carries only a
``path`` and stays in the last class (DC1: an unknown shape is never
silently a 4xx).  A rule's reason is lizyml's ``context["reason"]`` when
that is a plain token, else the rule's own default.

Nothing here passes lizyml's ``context`` through whole.  An input refusal
keeps the :data:`_INPUT_CONTEXT_KEYS` (the user's own column names and
values), never ``path`` or ``exception``.  An artifact refusal keeps only
what its rule proves safe (a bare file name, exact ints), never lizyml's
``repr()`` of a stored value, and its message is fixed text (lizyml's load
messages may name the artifact's absolute path).  Non-finite floats become
strings, so the envelope is always valid JSON.

The adapter applies the table to ``fit``, ``tune``, ``export_model``,
``export_code``, ``load_model`` and ``predict`` (:func:`maps_lizyml_refusals`).
Other methods, ``create_model`` among them, are not wrapped: a refusal they
raise stays a generic backend error.
"""

from __future__ import annotations

import functools
import logging
import math
import re
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Literal, ParamSpec, TypeVar

from lizystudio.backends.exceptions import (
    BackendArtifactError,
    BackendInputError,
)

logger = logging.getLogger(__name__)

ErrorClass = Literal["input", "artifact", "unclassified"]

_P = ParamSpec("_P")
_R = TypeVar("_R")

# A reason lizyml spells as a token (``unsupported_column_name``) is passed
# on for input refusals; free text (``"the type Period"``, an exception's str)
# is not.
_TOKEN = re.compile(r"[a-z][a-z0-9_]{0,63}")

# A bare file name a manifest refusal names (``refit_model.pkl``): no
# separator, so never a path.
_BASENAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}")

# The context keys an *input* refusal may carry.  Their values are the
# user's own data (column names, category values and their types, read from
# the file the user loaded) and lizyml's labels for them, shown back to the
# same user so they can find the column to fix; strings are capped and
# non-finite floats normalized.  ``path`` (an absolute local path) and
# ``exception`` (arbitrary text) are never among them.  An *artifact*
# refusal carries no lizyml context but what its rule extracts (see
# ``_manifest_context`` and ``_format_context``).
_INPUT_CONTEXT_KEYS: frozenset[str] = frozenset(
    {
        "alias",
        "column",
        "columns",
        "kind",
        "state",
        "surface",
        "type",
        "units",
        "value",
        "where",
    }
)
_DESCRIPTOR_KEYS: frozenset[str] = frozenset(
    {"where", "position", "type", "repr", "alias"}
)
_MAX_TEXT = 200

_REFIT = "run a new Fit"

Context = Mapping[str, Any]


def _has(*keys: str) -> Callable[[Context], bool]:
    def match(context: Context) -> bool:
        return any(key in context for key in keys)

    return match


def _has_all(*keys: str) -> Callable[[Context], bool]:
    def match(context: Context) -> bool:
        return all(key in context for key in keys)

    return match


def _surface_is(surface: str) -> Callable[[Context], bool]:
    def match(context: Context) -> bool:
        return context.get("surface") == surface

    return match


def _value_refusal(context: Context) -> bool:
    # category_values.encode / codegen.values: the value's type, and lizyml's
    # reason or where the value comes from.
    return "type" in context and ("reason" in context or "where" in context)


def _json_safe(value: Any, depth: int = 0) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value[:_MAX_TEXT] if isinstance(value, str) else value
    if isinstance(value, float):
        # NaN and the infinities are not JSON (JSONResponse refuses them).
        return value if math.isfinite(value) else repr(value)
    if depth < 2 and isinstance(value, (list, tuple)):
        return [_json_safe(v, depth + 1) for v in value]
    if depth < 2 and isinstance(value, Mapping):
        return {
            str(k): _json_safe(v, depth + 1)
            for k, v in value.items()
            if str(k) in _DESCRIPTOR_KEYS
        }
    return repr(value)[:_MAX_TEXT]


def _input_context(context: Context) -> dict[str, Any]:
    return {
        key: _json_safe(value)
        for key, value in context.items()
        if key in _INPUT_CONTEXT_KEYS
    }


def _no_context(_context: Context) -> dict[str, Any]:
    # The identity refusals put lizyml's repr() of the stored marker in their
    # context (``core/category_values.py`` ``identity_fields``); a corrupted
    # marker can hold anything, a local path included, so none of it is shown.
    return {}


def _manifest_context(context: Context) -> dict[str, Any]:
    file = context.get("file")
    if isinstance(file, str) and _BASENAME.fullmatch(file):
        return {"file": file}
    return {}


def _exact_int(value: Any) -> bool:
    return type(value) is int


def _format_context(context: Context) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if _exact_int(context.get("format_version")):
        out["format_version"] = context["format_version"]
    supported = context.get("supported")
    if isinstance(supported, list) and all(_exact_int(v) for v in supported):
        out["supported"] = list(supported)
    return out


@dataclass(frozen=True)
class Rule:
    """One row of the classification table."""

    code: str
    matches: Callable[[Context], bool]
    error_class: Literal["input", "artifact"]
    reason: str
    remedy: str
    context: Callable[[Context], dict[str, Any]]


#: The classification table (P-0117 D2).  First match wins; anything that
#: matches no row is ``unclassified``.  Each artifact row names the lizyml
#: 0.21.1 raise site whose context shape it matches.
RULES: tuple[Rule, ...] = (
    Rule(
        "SERIALIZATION_FAILED",
        _surface_is("export_code"),
        "input",
        "unsupported_column_name",
        "Rename the column in the data file to a plain text name, then "
        f"{_REFIT} and export the code again",
        _input_context,
    ),
    Rule(
        "SERIALIZATION_FAILED",
        _has("column"),
        "input",
        "unsaveable_category_value",
        "Convert the column's values to text or numbers in the data file, "
        f"then {_REFIT}",
        _input_context,
    ),
    Rule(
        "SERIALIZATION_FAILED",
        _value_refusal,
        "input",
        "unsaveable_value",
        f"Convert the values to text or numbers in the data file, then {_REFIT}",
        _input_context,
    ),
    Rule(
        "DATA_SCHEMA_INVALID",
        _has("column"),
        "input",
        "data_schema_invalid",
        "Fix the named column in the data file, then run again",
        _input_context,
    ),
    # core/category_values.py identity_fields (version check), re-raised by
    # persistence/loader.py _check_identity_markers with the path added.
    Rule(
        "DESERIALIZATION_FAILED",
        _has("category_identity_version"),
        "artifact",
        "unknown_category_identity_version",
        f"This version cannot read the saved model; {_REFIT}",
        _no_context,
    ),
    # core/category_values.py identity_fields (identity_columns check), same
    # re-raise.
    Rule(
        "DESERIALIZATION_FAILED",
        _has("identity_columns"),
        "artifact",
        "malformed_identity_columns",
        f"The saved model is damaged; {_REFIT}",
        _no_context,
    ),
    # persistence/loader.py _verify_and_read_pkl: a pickle whose SHA-256 is
    # not the one metadata.json records ({file, expected, actual}).
    Rule(
        "DESERIALIZATION_FAILED",
        _has_all("file", "expected", "actual"),
        "artifact",
        "checksum_mismatch",
        f"The saved model is damaged or was changed after it was saved; {_REFIT}",
        _manifest_context,
    ),
    # persistence/loader.py load: metadata.json names a format_version this
    # lizyml does not read ({format_version, supported}).
    Rule(
        "DESERIALIZATION_FAILED",
        _has_all("format_version", "supported"),
        "artifact",
        "unsupported_format_version",
        f"This version cannot read the saved model's format; {_REFIT}",
        _format_context,
    ),
)


@dataclass(frozen=True)
class Classification:
    """What :func:`classify` decided for one lizyml error."""

    error_class: ErrorClass
    backend_code: str
    reason: str
    remedy: str | None
    context: dict[str, Any]


def _code_of(exc: Any) -> str:
    code = getattr(exc, "code", None)
    value = getattr(code, "value", code)
    return value if isinstance(value, str) else "UNKNOWN"


def _reason_of(context: Context, default: str) -> str:
    reason = context.get("reason")
    if isinstance(reason, str) and _TOKEN.fullmatch(reason):
        return reason
    return default


def classify(exc: Any) -> Classification:
    """Classify a lizyml error by :data:`RULES`.

    Never raises: an object without a code or context is ``unclassified``
    under the code ``UNKNOWN``.  An unclassified error carries no context.
    """
    code = _code_of(exc)
    raw = getattr(exc, "context", None)
    context: Context = raw if isinstance(raw, Mapping) else {}
    for rule in RULES:
        # An input refusal passes lizyml's message on, so one whose context
        # locates a file (an I/O failure) is never an input refusal.
        if rule.error_class == "input" and "path" in context:
            continue
        if rule.code == code and rule.matches(context):
            # An artifact refusal keeps its rule's own reason: lizyml's
            # context of a broken artifact is not echoed, not even a token.
            reason = (
                _reason_of(context, rule.reason)
                if rule.error_class == "input"
                else rule.reason
            )
            return Classification(
                error_class=rule.error_class,
                backend_code=code,
                reason=reason,
                remedy=rule.remedy,
                context=rule.context(context),
            )
    return Classification(
        error_class="unclassified",
        backend_code=code,
        reason=_reason_of(context, code.lower()),
        remedy=None,
        context={},
    )


def _artifact_message(found: Classification) -> str:
    return f"The saved model cannot be read ({found.backend_code}: {found.reason})."


def translated(exc: Exception) -> Exception | None:
    """The Studio refusal for lizyml error *exc*, or ``None`` to keep it."""
    found = classify(exc)
    if found.error_class == "input":
        message = str(getattr(exc, "user_message", "") or found.reason)
        return BackendInputError(
            message,
            backend_code=found.backend_code,
            reason=found.reason,
            remedy=found.remedy or "",
            context=found.context,
        )
    if found.error_class == "artifact":
        return BackendArtifactError(
            _artifact_message(found),
            backend_code=found.backend_code,
            reason=found.reason,
            remedy=found.remedy or "",
            context=found.context,
        )
    logger.warning(
        "Unclassified lizyml error %s (reason %s) left as a backend error",
        found.backend_code,
        found.reason,
    )
    return None


@contextmanager
def lizyml_refusals() -> Iterator[None]:
    """Re-raise a classified lizyml error as its Studio refusal."""
    from lizyml.core.exceptions import LizyMLError

    try:
        yield
    except LizyMLError as exc:
        refusal = translated(exc)
        if refusal is None:
            raise
        raise refusal from exc


def maps_lizyml_refusals(fn: Callable[_P, _R]) -> Callable[_P, _R]:
    """Decorate an adapter method with :func:`lizyml_refusals`."""

    @functools.wraps(fn)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        with lizyml_refusals():
            return fn(*args, **kwargs)

    return wrapper


__all__ = [
    "RULES",
    "Classification",
    "ErrorClass",
    "Rule",
    "classify",
    "lizyml_refusals",
    "maps_lizyml_refusals",
    "translated",
]
