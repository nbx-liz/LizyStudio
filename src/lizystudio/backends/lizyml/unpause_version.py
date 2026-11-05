"""Refuse an unpause across lizyml minor versions (P-0117 D3, Decision A-2).

lizyml continues a study written by another library version with a warning
only, and its objective identity does not cover changes such as 0.21's new
``max_depth=0`` meaning, so a continued study could compare trials run
under different rules.  An unpause is therefore refused before the job
starts when the lizyml that wrote the paused job differs from the
installed one on major.minor, the rule retune applies to checkpoints
(:func:`.pickle_compat.verify_pickle_compatibility`).

The version is read from the job's checkpoint sidecar (``model_meta.json``
``lizyml_version``), because lizyml's public ``StudyLineage`` does not carry
the versions it records.  The lineage-state checks stay in
:mod:`.study_continuation`.

The sidecar lives beside the study's SQLite file: ``run_tune`` builds the
storage URL from the same job directory it passes as ``checkpoint_dir``
(``services/training.py`` ``run_tune``), and the tune bridge saves the
checkpoint, sidecar included, before every progress call a pause can be
raised from (``lifecycle_mixin.tune``).  So a paused job with a study and
no sidecar is a failed save, not a legitimate state, and it is refused,
like a sidecar that cannot be read or names no parseable version (DC1).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from lizystudio.backends.exceptions import CheckpointIncompatibleError

from .pickle_compat import MODEL_META, collect_pickle_versions, major_minor

_SQLITE_PREFIX = "sqlite:///"
_RECOVERY_HINT = "Start a new Tune"


def _refusal(
    message: str, *, kind: str, suggested_fix: str
) -> CheckpointIncompatibleError:
    return CheckpointIncompatibleError(
        f"{message} Start a new Tune.",
        kind=kind,
        recovery_hint=_RECOVERY_HINT,
        suggested_fix=suggested_fix,
    )


def sidecar_path(storage: str) -> Path:
    """The checkpoint sidecar beside the SQLite study file *storage* names.

    Raises:
        CheckpointIncompatibleError: ``missing_meta`` when *storage* is not
            a SQLite file URL, since no sidecar can be located for it.
    """
    if not storage.startswith(_SQLITE_PREFIX) or storage == _SQLITE_PREFIX:
        raise _refusal(
            "The paused job's checkpoint sidecar cannot be located: its study "
            "storage is not a SQLite file.",
            kind="missing_meta",
            suggested_fix="Start a new Tune; this paused study cannot be checked.",
        )
    return Path(storage[len(_SQLITE_PREFIX) :]).parent / MODEL_META


def _read_sidecar(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise _refusal(
            f"The paused job has no checkpoint sidecar ({path.name}), so the "
            "lizyml version that wrote its study is unknown.",
            kind="missing_meta",
            suggested_fix="Start a new Tune; this paused study cannot be checked.",
        ) from exc
    except OSError as exc:
        raise _corrupt(path, exc) from exc
    try:
        meta = json.loads(text)
    except json.JSONDecodeError as exc:
        raise _corrupt(path, exc) from exc
    if not isinstance(meta, dict):
        raise _corrupt(path, f"expected a JSON object, got {type(meta).__name__}")
    return meta


def _corrupt(path: Path, reason: object) -> CheckpointIncompatibleError:
    return _refusal(
        f"The paused job's checkpoint sidecar ({path.name}) is unreadable: {reason}.",
        kind="corrupt_meta",
        suggested_fix="Start a new Tune; this paused study cannot be checked.",
    )


def verify_same_lizyml_minor(storage: str) -> None:
    """Refuse the paused study at *storage* unless the installed lizyml minor wrote it.

    Raises:
        CheckpointIncompatibleError: ``lizyml_version_mismatch`` when the
            sidecar's ``lizyml_version`` is missing, not a string, has no
            parseable major.minor, or differs from the installed lizyml's
            major.minor; ``missing_meta`` / ``corrupt_meta`` when the
            sidecar is absent or cannot be read.
    """
    path = sidecar_path(storage)
    meta = _read_sidecar(path)
    saved = meta.get("lizyml_version")
    current = collect_pickle_versions()["lizyml_version"]
    saved_mm = major_minor(saved) if isinstance(saved, str) else None
    current_mm = major_minor(current)
    if saved_mm is not None and current_mm is not None and saved_mm == current_mm:
        return
    raise _refusal(
        f"The paused study was written by lizyml {saved!r} and the installed "
        f"lizyml is {current!r}; a study cannot be continued across lizyml "
        "minor versions.",
        kind="lizyml_version_mismatch",
        suggested_fix=(
            f"Start a new Tune under lizyml {current}, or pin the old runtime "
            f"(lizyml=={saved}) to continue this study."
            if isinstance(saved, str) and saved
            else f"Start a new Tune under lizyml {current}."
        ),
    )
