"""The one place lizyml's coded errors become Studio refusals (P-0117 D2).

lizyml raises :class:`lizyml.core.exceptions.LizyMLError` with a ``code``
and a structured ``context``.  :data:`RULES` classifies them, first match
wins:

* **input** -- the user's data cannot be used (a column name an
  export_code project cannot hold, a category value a saved model cannot
  hold, a data schema refusal naming a column).  Raised as
  :class:`BackendInputError`; the API answers 400.
* **artifact** -- a stored model cannot be read (its category identity
  marker is unknown or malformed, or lizyml names what else is wrong).
  Raised as :class:`BackendArtifactError`; the API answers 409.
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

Nothing here passes lizyml's ``context`` through whole: only the
:data:`_CONTEXT_ALLOWLIST` keys survive, never ``path`` or ``exception``,
and artifact messages are fixed text (lizyml's load messages may name the
artifact's absolute path).

The adapter applies the table to ``fit``, ``tune``, ``export_model``,
``export_code``, ``load_model`` and ``predict`` (:func:`maps_lizyml_refusals`).
Other methods, ``create_model`` among them, are not wrapped: a refusal they
raise stays a generic backend error.
"""

from __future__ import annotations

import functools
import logging
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
# on; free text (``"the type Period"``, an exception's str) is not.
_TOKEN = re.compile(r"[a-z][a-z0-9_]{0,63}")

# The context keys a response may carry.  ``path`` (an absolute local path)
# and ``exception`` (arbitrary text) are never among them.
_CONTEXT_ALLOWLIST: frozenset[str] = frozenset(
    {
        "alias",
        "category_identity_version",
        "column",
        "columns",
        # The artifact file a manifest refusal names: a basename, not a path.
        "file",
        "format_version",
        "identity_columns",
        "kind",
        "state",
        "surface",
        "type",
        "units",
        "value",
        "where",
    }
)

_REFIT = "run a new Fit"


def _has(*keys: str) -> Callable[[Mapping[str, Any]], bool]:
    def match(context: Mapping[str, Any]) -> bool:
        return any(key in context for key in keys)

    return match


def _surface_is(surface: str) -> Callable[[Mapping[str, Any]], bool]:
    def match(context: Mapping[str, Any]) -> bool:
        return context.get("surface") == surface

    return match


def _value_refusal(context: Mapping[str, Any]) -> bool:
    # category_values.encode / codegen.values: the value's type, and lizyml's
    # reason or where the value comes from.
    return "type" in context and ("reason" in context or "where" in context)


def _diagnosed(context: Mapping[str, Any]) -> bool:
    # lizyml named what is wrong, not only where the artifact is: a bare
    # ``{"path": ...}`` (missing directory, I/O error) stays unclassified.
    return any(key != "path" for key in context)


@dataclass(frozen=True)
class Rule:
    """One row of the classification table."""

    code: str
    matches: Callable[[Mapping[str, Any]], bool]
    error_class: Literal["input", "artifact"]
    reason: str
    remedy: str


#: The classification table (P-0117 D2).  First match wins; anything that
#: matches no row is ``unclassified``.
RULES: tuple[Rule, ...] = (
    Rule(
        "SERIALIZATION_FAILED",
        _surface_is("export_code"),
        "input",
        "unsupported_column_name",
        "Rename the column in the data file to a plain text name, then "
        f"{_REFIT} and export the code again",
    ),
    Rule(
        "SERIALIZATION_FAILED",
        _has("column"),
        "input",
        "unsaveable_category_value",
        "Convert the column's values to text or numbers in the data file, "
        f"then {_REFIT}",
    ),
    Rule(
        "SERIALIZATION_FAILED",
        _value_refusal,
        "input",
        "unsaveable_value",
        f"Convert the values to text or numbers in the data file, then {_REFIT}",
    ),
    Rule(
        "DATA_SCHEMA_INVALID",
        _has("column"),
        "input",
        "data_schema_invalid",
        "Fix the named column in the data file, then run again",
    ),
    Rule(
        "DESERIALIZATION_FAILED",
        _has("category_identity_version"),
        "artifact",
        "unknown_category_identity_version",
        f"This version cannot read the saved model; {_REFIT}",
    ),
    Rule(
        "DESERIALIZATION_FAILED",
        _has("identity_columns"),
        "artifact",
        "malformed_identity_columns",
        f"The saved model is damaged; {_REFIT}",
    ),
    Rule(
        "DESERIALIZATION_FAILED",
        _diagnosed,
        "artifact",
        "artifact_unreadable",
        f"The saved model is damaged or incomplete; {_REFIT}",
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


def _reason_of(context: Mapping[str, Any], default: str) -> str:
    reason = context.get("reason")
    if isinstance(reason, str) and _TOKEN.fullmatch(reason):
        return reason
    return default


def _json_safe(value: Any, depth: int = 0) -> Any:
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if depth < 2 and isinstance(value, (list, tuple)):
        return [_json_safe(v, depth + 1) for v in value]
    if depth < 2 and isinstance(value, Mapping):
        return {
            str(k): _json_safe(v, depth + 1)
            for k, v in value.items()
            if str(k) in _CONTEXT_ALLOWLIST or k == "repr" or k == "position"
        }
    return repr(value)[:200]


def _safe_context(context: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: _json_safe(value)
        for key, value in context.items()
        if key in _CONTEXT_ALLOWLIST
    }


def classify(exc: Any) -> Classification:
    """Classify a lizyml error by :data:`RULES`.

    Never raises: an object without a code or context is ``unclassified``
    under the code ``UNKNOWN``.
    """
    code = _code_of(exc)
    raw = getattr(exc, "context", None)
    context: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
    for rule in RULES:
        # An input refusal passes lizyml's message on, so one whose context
        # locates a file (an I/O failure) is never an input refusal.
        if rule.error_class == "input" and "path" in context:
            continue
        if rule.code == code and rule.matches(context):
            return Classification(
                error_class=rule.error_class,
                backend_code=code,
                reason=_reason_of(context, rule.reason),
                remedy=rule.remedy,
                context=_safe_context(context),
            )
    return Classification(
        error_class="unclassified",
        backend_code=code,
        reason=_reason_of(context, code.lower()),
        remedy=None,
        context=_safe_context(context),
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
