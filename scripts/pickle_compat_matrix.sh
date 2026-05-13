#!/usr/bin/env bash
# pickle_compat_matrix.sh — cross-minor pickle compatibility gate (v3-26).
#
# Verifies that the runtime ``lizyml`` install rejects checkpoints saved
# by past minor releases with a clear, structured ``PICKLE_INCOMPATIBLE``
# error (kind ``lizyml_version_mismatch``) — never a silent successful
# load that would corrupt the model state.
#
# The script runs in two halves:
#
# 1. For each past lizyml version in ``$PAST_VERSIONS`` (default: the
#    N-1, N-2, N-3 minors below the current ``lizyml`` install), a
#    throwaway venv is provisioned with that exact lizyml version, and a
#    tiny ``save_checkpoint`` is invoked into ``$ARTEFACT_DIR/<version>/``.
# 2. Back in the current runtime, ``verify_pickle_compatibility`` is
#    invoked against each saved sidecar. Each call must raise
#    ``PickleIncompatibleError`` with ``kind=lizyml_version_mismatch``
#    (or, when the on-disk schema bumps across the boundary, the
#    ``schema_mismatch`` kind — both are valid rejection paths).
#
# Used by ``.github/workflows/nightly.yml`` ``pickle-compat`` job.
#
# Local invocation::
#
#     PAST_VERSIONS="0.12.0 0.13.0 0.14.0" bash scripts/pickle_compat_matrix.sh
#
# Exit 0 — every past version was rejected with the expected envelope.
# Exit 1 — at least one past version was silently loaded OR raised the
# wrong error kind. Either case is a regression of the v3-26 invariant.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ARTEFACT_DIR="${ARTEFACT_DIR:-/tmp/pickle_compat_matrix}"
PAST_VERSIONS="${PAST_VERSIONS:-0.12.0 0.13.0 0.14.0}"

# Resolve the runtime version so the matrix table prints a clear contrast
# between "saved with X" and "verified against Y" in the CI log.
CURRENT_VERSION="$(uv run python -c 'import lizyml; print(lizyml.__version__)')"

echo "================================================================"
echo "Pickle compatibility matrix (v3-26)"
echo "  Runtime lizyml: ${CURRENT_VERSION}"
echo "  Past versions:  ${PAST_VERSIONS}"
echo "  Artefact dir:   ${ARTEFACT_DIR}"
echo "================================================================"

rm -rf "$ARTEFACT_DIR"
mkdir -p "$ARTEFACT_DIR"

# ---------------------------------------------------------------------------
# Phase 1: save a checkpoint with each past lizyml minor in an isolated venv.
# ---------------------------------------------------------------------------
for V in $PAST_VERSIONS; do
    if [ "$V" = "$CURRENT_VERSION" ]; then
        echo "[skip] ${V} is the current runtime; nothing to verify against."
        continue
    fi
    echo ""
    echo "--- Saving checkpoint with lizyml==${V} ---"
    OUT_DIR="${ARTEFACT_DIR}/${V}"
    mkdir -p "$OUT_DIR"
    # Provision an ephemeral venv that does NOT touch the host uv cache;
    # we want the past minor to load cleanly even if its transitive
    # deps differ from the current runtime.
    VENV_DIR="${ARTEFACT_DIR}/.venv-${V}"
    uv venv --python 3.11 "$VENV_DIR" >/dev/null
    # ``uv pip install`` in the local venv keeps the host project env clean.
    VIRTUAL_ENV="$VENV_DIR" uv pip install --quiet \
        "lizyml==${V}" cloudpickle >/dev/null

    # Save a synthetic sidecar that mirrors what
    # ``LizyMLAdapter.save_checkpoint`` writes. We deliberately do NOT
    # invoke the past version's Studio adapter (Studio is forward-only
    # against lizyml); the sidecar shape has been stable since H-0062.
    VIRTUAL_ENV="$VENV_DIR" "$VENV_DIR/bin/python" - "$OUT_DIR" <<'PY'
import json
import sys
from pathlib import Path

import cloudpickle
import lizyml

out_dir = Path(sys.argv[1])
model_path = out_dir / "model.pkl"
meta_path = out_dir / "model_meta.json"

# A tiny picklable sentinel — the matrix is about envelope shape,
# not the actual model state.
with model_path.open("wb") as fh:
    cloudpickle.dump({"_marker": "pickle_compat_matrix"}, fh)

meta = {
    "pickle_schema": 1,
    "lizyml_version": lizyml.__version__,
    "lightgbm_version": "matrix-fixture",
    "optuna_version": "matrix-fixture",
    "saved_at": "1970-01-01T00:00:00+00:00",
}
meta_path.write_text(json.dumps(meta), encoding="utf-8")
print(f"[saved] lizyml={lizyml.__version__} -> {out_dir}")
PY
done

# ---------------------------------------------------------------------------
# Phase 2: verify each saved sidecar is REJECTED by the current runtime.
# ---------------------------------------------------------------------------
echo ""
echo "--- Verifying rejection against runtime lizyml==${CURRENT_VERSION} ---"
uv run python - "$ARTEFACT_DIR" "$CURRENT_VERSION" <<'PY'
import json
import sys
from pathlib import Path

from lizystudio.backends.lizyml import (
    PickleIncompatibleError,
    verify_pickle_compatibility,
)

artefact_dir = Path(sys.argv[1])
current_version = sys.argv[2]
failures: list[str] = []
verified = 0

for sub in sorted(artefact_dir.iterdir()):
    if not sub.is_dir() or sub.name.startswith("."):
        continue
    meta_path = sub / "model_meta.json"
    if not meta_path.exists():
        continue
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    saved = meta["lizyml_version"]
    if saved == current_version:
        # Same major.minor — verification SHOULD succeed; that's a
        # forward-compat sanity check, not a v3-26 failure.
        try:
            verify_pickle_compatibility(meta)
        except PickleIncompatibleError as exc:
            failures.append(
                f"  {saved}: matching version unexpectedly rejected: {exc}"
            )
        else:
            print(f"  {saved}: accepted (matches runtime) — ok")
        continue
    try:
        verify_pickle_compatibility(meta)
    except PickleIncompatibleError as exc:
        if exc.kind not in {"lizyml_version_mismatch", "schema_mismatch"}:
            failures.append(
                f"  {saved}: rejected with unexpected kind={exc.kind!r}"
            )
            continue
        if not exc.recovery_hint or not exc.suggested_fix:
            failures.append(
                f"  {saved}: kind={exc.kind} but envelope missing "
                f"recovery_hint or suggested_fix"
            )
            continue
        print(f"  {saved}: rejected (kind={exc.kind}) — ok")
        verified += 1
    else:
        failures.append(
            f"  {saved}: SILENT LOAD against runtime {current_version} "
            f"(verify_pickle_compatibility returned without raising)"
        )

print()
print(f"Verified {verified} past minor(s) against runtime {current_version}.")
if failures:
    print("FAILED:")
    for line in failures:
        print(line)
    sys.exit(1)
PY

echo ""
echo "================================================================"
echo "Pickle compat matrix: all past versions correctly rejected."
echo "================================================================"
