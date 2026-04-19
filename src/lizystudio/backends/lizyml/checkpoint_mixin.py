"""Checkpoint persistence methods for LizyMLAdapter."""

from __future__ import annotations

import contextlib
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from pickle import PicklingError
from typing import Any

import cloudpickle

from lizystudio.backends.exceptions import (
    CheckpointIncompatibleError,
    CheckpointPreflightError,
)

from .pickle_compat import (
    MODEL_META,
    MODEL_META_TMP,
    MODEL_PKL,
    MODEL_PKL_TMP,
    PICKLE_SCHEMA_VERSION,
    PickleIncompatibleError,
    PicklePreflightError,
    collect_pickle_versions,
    preflight_pickle_check,
    verify_pickle_compatibility,
)

logger = logging.getLogger(__name__)


class CheckpointMixin:
    """Save and load model checkpoints."""

    def preflight_checkpoint_dir(self, job_dir: Path) -> None:
        """Fail fast before tune if *job_dir* cannot host a checkpoint (H-0068).

        Raises :class:`CheckpointPreflightError` when the target dir is
        not writable or cloudpickle cannot round-trip a sentinel.  The
        service layer translates this to the API-layer envelope.
        """

        try:
            preflight_pickle_check(Path(job_dir))
        except PicklePreflightError as exc:
            raise CheckpointPreflightError(str(exc)) from exc

    def verify_checkpoint_compatibility(self, job_dir: Path) -> None:
        """Validate ``job_dir/model_meta.json`` against the current runtime (H-0068).

        Missing sidecars (legacy checkpoints pre-H-0062) are tolerated
        as a no-op.  Corrupted sidecars and version mismatches both
        surface as :class:`CheckpointIncompatibleError` so the API layer
        can respond uniformly without importing from this package.
        """
        meta_path = Path(job_dir) / MODEL_META
        if not meta_path.exists():
            return
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CheckpointIncompatibleError(
                f"Corrupted model_meta.json at {meta_path}: {exc}"
            ) from exc
        try:
            verify_pickle_compatibility(meta)
        except PickleIncompatibleError as exc:
            raise CheckpointIncompatibleError(str(exc)) from exc

    def save_checkpoint(self, model: Any, path: Path) -> None:
        """Atomically persist *model* as ``path/model.pkl`` via temp+rename."""
        target_dir = Path(path)
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.warning("checkpoint: cannot create %s: %s", target_dir, exc)
            return

        tmp_path = target_dir / MODEL_PKL_TMP
        final_path = target_dir / MODEL_PKL
        try:
            with tmp_path.open("wb") as fh:
                cloudpickle.dump(model, fh)
            os.replace(tmp_path, final_path)
        except (OSError, PicklingError, RecursionError) as exc:
            logger.warning(
                "checkpoint save failed at %s: %s",
                final_path,
                exc,
            )
            with contextlib.suppress(OSError):
                tmp_path.unlink(missing_ok=True)
            return

        meta_tmp = target_dir / MODEL_META_TMP
        meta_final = target_dir / MODEL_META
        try:
            meta_payload: dict[str, Any] = {
                "pickle_schema": PICKLE_SCHEMA_VERSION,
                "saved_at": datetime.now(timezone.utc).isoformat(),
                **collect_pickle_versions(),
            }
            meta_tmp.write_text(
                json.dumps(meta_payload, ensure_ascii=False),
                encoding="utf-8",
            )
            os.replace(meta_tmp, meta_final)
        except OSError as exc:
            logger.warning("checkpoint meta write failed at %s: %s", meta_final, exc)
            with contextlib.suppress(OSError):
                meta_tmp.unlink(missing_ok=True)

    def load_checkpoint(self, path: Path, *, allowed_root: Path | None = None) -> Any:
        """Load ``path/model.pkl`` after verifying ``model_meta.json``."""
        target_dir = Path(path)
        if allowed_root is not None:
            from lizystudio.security import validate_path_within

            target_dir = validate_path_within(target_dir, Path(allowed_root))

        pkl_path = target_dir / MODEL_PKL
        if not pkl_path.exists():
            raise FileNotFoundError(f"No checkpoint at {pkl_path}")

        meta_path = target_dir / MODEL_META
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            verify_pickle_compatibility(meta)
        else:
            logger.warning(
                "Loading checkpoint %s without model_meta.json — "
                "pickle compatibility cannot be verified",
                pkl_path,
            )

        with pkl_path.open("rb") as fh:
            return cloudpickle.load(fh)  # noqa: S301
