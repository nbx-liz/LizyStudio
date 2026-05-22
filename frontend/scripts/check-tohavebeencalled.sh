#!/bin/bash
# CI guard: forbid bare ``.toHaveBeenCalled()`` in frontend test files.
#
# Issue #537: the v0.6.2 Target-select bug cluster (#529 / #530 / #531)
# slipped past the unit suite because assertions checked *that* a mock was
# called, not *how many times*. A callback firing 4-9 times when it should
# fire once satisfies ``.toHaveBeenCalled()`` silently. The audit converted
# every existing site to ``.toHaveBeenCalledTimes(N)``; this guard stops a
# regression from landing a new bare assertion.
#
# Allowed (NOT flagged):
#   - ``.toHaveBeenCalledTimes(N)``  — the count-precise form
#   - ``.not.toHaveBeenCalled()``    — already encodes a count of 0
#   - ``.toHaveBeenCalledWith(...)`` — asserts args, a different question
#
# Exit 1 if any bare ``.toHaveBeenCalled()`` is found.
# Usage: bash scripts/check-tohavebeencalled.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$FRONTEND_DIR"

if ! command -v grep >/dev/null 2>&1; then
  echo "ERROR: grep is required but not found in PATH." >&2
  exit 2
fi

echo "Scanning src/ test files for bare .toHaveBeenCalled() (Issue #537 guard)..."

# ``.toHaveBeenCalled()`` matches the bare assertion. It also appears inside
# ``.not.toHaveBeenCalled()`` — those lines are filtered out below. The
# ``Times`` / ``With`` variants do not contain the literal ``Called()`` so
# they never match in the first place.
MATCHES="$(grep -rHn \
  --include='*.test.ts' --include='*.test.tsx' \
  '\.toHaveBeenCalled()' src/ || true)"

VIOLATIONS=""
if [[ -n "$MATCHES" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # ``.not.toHaveBeenCalled()`` already encodes count 0 — allowed.
    if [[ "$line" == *".not.toHaveBeenCalled()"* ]]; then
      continue
    fi
    VIOLATIONS+="${line}"$'\n'
  done <<< "$MATCHES"
fi

if [[ -n "$VIOLATIONS" ]]; then
  echo ""
  echo "ERROR: bare .toHaveBeenCalled() found in test files:"
  echo ""
  printf '%s' "$VIOLATIONS"
  echo ""
  echo "Fix: assert the intended call count, not just the fact of a call."
  echo "  expect(spy).toHaveBeenCalled()  ->  expect(spy).toHaveBeenCalledTimes(N)"
  echo "  When N is not 1, add a one-line comment naming the reason."
  echo "  See CLAUDE.md section 7 (Flaky / test-quality conventions)."
  exit 1
fi

echo "OK: no bare .toHaveBeenCalled() in test files."
