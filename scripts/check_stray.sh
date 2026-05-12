#!/usr/bin/env bash
# block-stray-artifacts — pre-commit tripwire for accidentally staged scratch files.
#
# Most artefact patterns below are already covered by .gitignore, but `git add -f`
# / `git add .` from an unexpected cwd / a future .gitignore edit can let one
# through. This hook fails the commit when the *staged* set contains files that
# look like spike output, coverage dumps, or build artefacts.
#
# Allowed exceptions (intentional, tracked):
#   - docs/images/*.png            doc illustrations
#   - tests/fixtures/**            backend production-artefact fixtures (any ext)
#   - frontend/src/__fixtures__/** frontend fixtures
#   - frontend/tests/e2e/__screenshots__/**  Playwright visual goldens
#   - data/**                      analysis data dir (its own .gitignore rules)
#
# Override (rare, document the reason in the commit body): `git commit --no-verify`.
#
# Exit 0 = clean, 1 = stray file staged.
set -euo pipefail

staged="$(git diff --cached --name-only --diff-filter=AM)"
[ -z "$staged" ] && exit 0

bad=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    # explicitly-allowed locations — skip
    docs/images/*.png) continue ;;
    tests/fixtures/*) continue ;;
    frontend/src/__fixtures__/*) continue ;;
    frontend/tests/e2e/__screenshots__/*) continue ;;
    data/*) continue ;;
  esac
  case "$f" in
    # root-level data/image artefacts (no slash in path => repo root)
    *.png|*.csv|*.parquet)
      case "$f" in */*) ;; *) bad="$bad $f" ;; esac ;;
    # coverage dumps, anywhere
    coverage.json|.coverage|*/coverage.json|*/.coverage) bad="$bad $f" ;;
    # build artefacts
    dist/*.whl|dist/*.tar.gz|*/dist/*.whl|*/dist/*.tar.gz) bad="$bad $f" ;;
    # TypeScript incremental build info
    *.tsbuildinfo) bad="$bad $f" ;;
  esac
done <<< "$staged"

if [ -n "$bad" ]; then
  echo "block-stray-artifacts: refusing to commit scratch/build artefacts:" >&2
  for f in $bad; do echo "  - $f" >&2; done
  echo >&2
  echo "These belong under tmp/ (gitignored) — see CONTRIBUTING.md § Working artefacts." >&2
  echo "If this file is genuinely intended for the repo, re-run with: git commit --no-verify" >&2
  echo "(and explain why in the commit body)." >&2
  exit 1
fi
exit 0
