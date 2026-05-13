"""Pickle preflight + version compatibility check for the LizyML backend.

H-0062 Phase B: extracted from the monolithic ``lizyml.py`` so the
checkpoint-persistence helpers can evolve independently of the adapter
proper. The public surface is re-exported from ``lizystudio.backends.lizyml``
for backward compatibility.
"""

from __future__ import annotations

import contextlib
from pathlib import Path
from typing import Any

import cloudpickle


class PicklePreflightError(RuntimeError):
    """Raised before tune starts when the job dir is not usable for
    pickle persistence (no write perms, SELinux denial, or unpicklable
    skeleton)."""


class PickleIncompatibleError(RuntimeError):
    """Raised by ``load_checkpoint`` / ``verify_pickle_compatibility`` when
    the on-disk ``model_meta.json`` points at a schema or major backend
    version the current Studio cannot safely deserialize.

    P-0107 (v3-26c): carries a structured ``kind`` classification, a
    ``recovery_hint`` (one-sentence "what to do next" for the user),
    and a ``suggested_fix`` (concrete command or value the UI can show
    on a copy-paste affordance). The API envelope (``api/errors.py``)
    surfaces these fields in ``details`` so the frontend can render
    actionable guidance instead of a raw "Checkpoint incompatible: ..."
    string.

    ``kind`` values:

    - ``"schema_mismatch"`` -- ``PICKLE_SCHEMA_VERSION`` bumped
    - ``"lizyml_version_mismatch"`` -- saved lizyml major.minor differs
      from the runtime
    - ``"unknown"`` -- fallback when callers construct the error
      without classification (legacy code paths, future error sources)
    """

    def __init__(
        self,
        message: str,
        *,
        kind: str = "unknown",
        recovery_hint: str | None = None,
        suggested_fix: str | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.recovery_hint = recovery_hint
        self.suggested_fix = suggested_fix


PICKLE_SCHEMA_VERSION = 1
MODEL_PKL = "model.pkl"
MODEL_PKL_TMP = "model.pkl.tmp"
MODEL_META = "model_meta.json"
MODEL_META_TMP = "model_meta.json.tmp"


def collect_pickle_versions() -> dict[str, str]:
    """Snapshot the lizyml / lightgbm / optuna versions for the sidecar."""
    import lizyml

    versions: dict[str, str] = {
        "lizyml_version": getattr(lizyml, "__version__", "unknown"),
    }
    try:
        import lightgbm

        versions["lightgbm_version"] = getattr(lightgbm, "__version__", "unknown")
    except ImportError:  # pragma: no cover - lightgbm is a hard dep
        versions["lightgbm_version"] = "unknown"
    try:
        import optuna

        versions["optuna_version"] = getattr(optuna, "__version__", "unknown")
    except ImportError:  # pragma: no cover - optuna is a hard dep
        versions["optuna_version"] = "unknown"
    return versions


def major_minor(version: str) -> tuple[int, int] | None:
    """Parse ``'0.9.1'`` into ``(0, 9)`` for version-compat comparison.

    Strips PEP 440 local / dev / pre-release suffixes so that the
    base ``major.minor`` is compared even for builds like
    ``'0.9.1.dev3+local'`` or ``'0.9.0a1'``. The strictness comes from
    the major/minor equality check in ``verify_pickle_compatibility``;
    if a dev build's pickle format diverges from the matching stable
    release, the fix is to bump ``PICKLE_SCHEMA_VERSION``.
    """
    cleaned = version.split("+", 1)[0]
    parts = cleaned.split(".")
    if len(parts) < 2:
        return None
    numeric_parts: list[str] = []
    for raw in parts[:2]:
        digits = ""
        for ch in raw:
            if ch.isdigit():
                digits += ch
            else:
                break
        numeric_parts.append(digits)
    if not numeric_parts[0] or not numeric_parts[1]:
        return None
    try:
        return int(numeric_parts[0]), int(numeric_parts[1])
    except ValueError:
        return None


def verify_pickle_compatibility(meta: dict[str, Any]) -> None:
    """Reject a checkpoint whose sidecar points at an incompatible runtime.

    The check is intentionally strict: we only accept the exact pickle
    schema version and an exact lizyml major.minor match.  Anything else
    raises so the caller can show a clear error to the user rather than
    silently loading a bad model state.
    """
    schema = meta.get("pickle_schema")
    if schema != PICKLE_SCHEMA_VERSION:
        raise PickleIncompatibleError(
            f"Unsupported pickle_schema: expected {PICKLE_SCHEMA_VERSION}, "
            f"got {schema!r}",
            kind="schema_mismatch",
            recovery_hint=(
                "The on-disk checkpoint format changed in this Studio release. "
                "Past checkpoints cannot be loaded; you need to refit the model."
            ),
            suggested_fix=(
                f"Refit the workspace to produce a model with "
                f"pickle_schema={PICKLE_SCHEMA_VERSION}, or downgrade Studio "
                f"to a release whose pickle_schema matches the saved "
                f"value ({schema!r})."
            ),
        )

    current = collect_pickle_versions()
    saved_lizyml = str(meta.get("lizyml_version", ""))
    current_mm = major_minor(current["lizyml_version"])
    saved_mm = major_minor(saved_lizyml)
    if current_mm is None or saved_mm is None or current_mm != saved_mm:
        raise PickleIncompatibleError(
            "Incompatible lizyml version: checkpoint was saved with "
            f"{saved_lizyml!r}, current runtime is "
            f"{current['lizyml_version']!r}",
            kind="lizyml_version_mismatch",
            recovery_hint=(
                "The lizyml major.minor changed since this checkpoint was "
                "saved. Pickles cannot cross minor boundaries (internal "
                "class moves invalidate the serialized state); refit on the "
                "current lizyml to produce a fresh checkpoint."
            ),
            suggested_fix=(
                f"Either refit the workspace under lizyml "
                f"{current['lizyml_version']}, or pin the old runtime with "
                f"``uv add lizyml=={saved_lizyml}`` to reload this artefact."
            ),
        )


def preflight_pickle_check(job_dir: Path) -> None:
    """Fail fast before tune if ``job_dir`` cannot host a pickle file.

    Catches the common 'tune ran for an hour and then pickle save
    failed' class of bugs by verifying:

    1. The job dir is writable (creates and removes ``.write_test``)
    2. cloudpickle can round-trip a minimal sentinel object

    Real Model-specific picklability cannot be tested here because it
    requires the fitted instance, which is exactly what we are trying
    to produce.  The first real save attempt will surface any remaining
    pickling issue (logged as WARNING, tune continues).
    """
    job_dir.mkdir(parents=True, exist_ok=True)
    probe = job_dir / ".write_test"
    try:
        probe.write_bytes(b"ok")
    except OSError as exc:
        raise PicklePreflightError(
            f"Job directory {job_dir} is not writable: {exc}"
        ) from exc
    finally:
        if probe.exists():
            with contextlib.suppress(OSError):
                probe.unlink()

    sentinel: dict[str, Any] = {"_pickle_schema": PICKLE_SCHEMA_VERSION}
    try:
        cloudpickle.loads(cloudpickle.dumps(sentinel))
    except Exception as exc:  # noqa: BLE001 — cloudpickle can raise many
        raise PicklePreflightError(f"cloudpickle round-trip failed: {exc}") from exc
