#!/bin/bash
# CI guard: forbid raw Tailwind color utilities in application source.
#
# After B-9 Part 1 (H-0078) migrated all status/chrome coloring to semantic
# tokens defined in design-tokens.css + tailwind.config.ts, regressions like
# ``bg-green-100`` / ``text-red-600`` are considered bugs: they bypass the
# dark-mode inversion layer and the WCAG-audited contrast palette.
#
# Exit 1 if any forbidden class is found outside the allowlist below.
# Usage: bash scripts/check-raw-colors.sh
#
# Allowlist (palette-as-identity, not status colors):
#   - DistributionBar.tsx                — categorical palette for feature slices
#   - FoldPreview.tsx                    — train/valid fold highlight colors
#   - SearchSpaceEvolutionPanel.tsx      — cutoff bar identity color
#   - JobList.tsx                        — fit/tune job-type identifier
#   - design-tokens.css                  — comments mapping tokens back to Tailwind shades
#   - JobDetail.tsx                      — comment explaining a historical contrast fix

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$FRONTEND_DIR"

# Color utilities that must NOT appear in src/** outside the allowlist.
# Matches e.g. bg-blue-500, text-red-600, border-yellow-300, ring-emerald-400,
# from-slate-900, to-gray-100, via-pink-200, fill-amber-500, stroke-rose-400.
PATTERN='(bg|text|border|ring|fill|stroke|from|to|via)-(blue|green|red|yellow|amber|rose|emerald|orange|slate|gray|zinc|sky|indigo|violet|purple|pink|fuchsia|cyan|teal|lime|neutral|stone)-[0-9]{2,3}'

# Files exempted from the check. Keep this list short; every addition is
# technical debt until justified as palette-as-identity.
ALLOWLIST_REGEX='^src/(components/workspace/DistributionBar\.tsx|components/workspace/FoldPreview\.tsx|components/retune/SearchSpaceEvolutionPanel\.tsx|components/jobs/JobList\.tsx|components/jobs/JobDetail\.tsx|components/ui/design-tokens\.css)$'

echo "Scanning src/ for raw Tailwind color utilities (B-9 Part 2 guard)..."

# Use grep -r which is ubiquitous. -E enables extended regex; -H prints the
# filename; -n prints the line number. ``|| true`` swallows the ``no match''
# exit code (1) but would also hide a command-not-found error (127) — the
# leading ``command -v grep`` check prevents that.
if ! command -v grep >/dev/null 2>&1; then
  echo "ERROR: grep is required but not found in PATH." >&2
  exit 2
fi

MATCHES="$(grep -rEHn \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.css' \
  "$PATTERN" src/ || true)"

# Filter out allowlisted files. The ``src/foo/bar.tsx:NN:line`` output format
# from grep lets us split on the first colon to isolate the path.
VIOLATIONS=""
if [[ -n "$MATCHES" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    path="${line%%:*}"
    if [[ ! "$path" =~ $ALLOWLIST_REGEX ]]; then
      VIOLATIONS+="${line}"$'\n'
    fi
  done <<< "$MATCHES"
fi

if [[ -n "$VIOLATIONS" ]]; then
  echo ""
  echo "ERROR: raw Tailwind color classes found outside the allowlist:"
  echo ""
  printf '%s' "$VIOLATIONS"
  echo ""
  echo "Fix: replace with a semantic token from design-tokens.css"
  echo "  (bg-success / text-warning-fg / border-danger / bg-info etc.)"
  echo "  or, if this is truly a palette-as-identity usage, add the file to"
  echo "  the ALLOWLIST_REGEX in frontend/scripts/check-raw-colors.sh and"
  echo "  explain why in the comment block at the top."
  exit 1
fi

echo "OK: no raw Tailwind color classes outside the allowlist."
