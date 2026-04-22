#!/bin/bash
# CI guard: forbid any reintroduction of the retired ``apiFetch`` helper.
#
# C-6 Phase 5 (H-0080) retired ``apiFetch`` / ``BASE_URL`` from
# ``src/api/client.ts`` in favour of the openapi-fetch-based
# ``apiClient``. This guard prevents regressions where someone copies
# an old snippet or ports code from another project that still uses
# the hand-rolled fetcher.
#
# Exit 1 if any forbidden call-site pattern is found. Historical
# mentions inside comments and docs are allowed — the guard matches
# actual TypeScript usage (import, export, function call, generic
# parameter), not free-form prose.
#
# Usage: bash scripts/check-no-apifetch.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$FRONTEND_DIR"

if ! command -v grep >/dev/null 2>&1; then
  echo "ERROR: grep is required but not found in PATH." >&2
  exit 2
fi

# Code-level patterns that would reintroduce apiFetch usage:
#   - ``apiFetch(...)``       — function call
#   - ``apiFetch<T>(...)``    — generic call
#   - ``import ... apiFetch`` — named import
#   - ``export ... apiFetch`` — re-export
# Free-form prose like ``the hand-rolled apiFetch`` in comments does
# not match (no ``(``, ``<``, ``import``, or ``export`` adjacent).
PATTERN='apiFetch\s*[<(]|(import|export)[^;]*\bapiFetch\b'

echo "Scanning src/ for retired apiFetch usage (C-6 Phase 5 guard)..."

MATCHES="$(grep -rEHn \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  "$PATTERN" src/ || true)"

if [[ -n "$MATCHES" ]]; then
  echo ""
  echo "ERROR: retired apiFetch usage found:"
  echo ""
  printf '%s\n' "$MATCHES"
  echo ""
  echo "Fix: use the openapi-fetch-based ``apiClient`` from"
  echo "     ``src/api/client.ts`` instead. See docs/c6-openapi-fetch-plan.md"
  echo "     and any of src/api/{files,inference,workspace,jobs}.ts for"
  echo "     migration patterns."
  exit 1
fi

echo "OK: no apiFetch call sites in src/."
