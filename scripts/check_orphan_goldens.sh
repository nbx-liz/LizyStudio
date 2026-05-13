#!/usr/bin/env bash
# check_orphan_goldens — fail when a committed Playwright visual golden lives
# under a project directory that no CI workflow exercises (#456 L3 / failure
# mode M4). The chromium-mobile orphan cleaned up in #455 was discovered by
# accident, not by tooling; this step is the tripwire so the next CI-matrix
# change cannot strand a golden.
#
# A golden path looks like:
#   frontend/tests/e2e/__screenshots__/<project>/visual/<spec>/<name>.png
# A workflow exercises <project> when it passes `--project=<project>` to
# `playwright test`.
#
# Exit 0 = every committed golden's project is run by some workflow, 1 = orphan.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

prefix="frontend/tests/e2e/__screenshots__/"
goldens="$(git ls-files "${prefix}*/*" | sed "s|^${prefix}||" | cut -d/ -f1 | sort -u)"
[ -z "$goldens" ] && { echo "check_orphan_goldens: no committed goldens"; exit 0; }

ci_projects="$(grep -rhoE -- '--project=[A-Za-z0-9_-]+' .github/workflows/ \
  | sed 's/^--project=//' | sort -u)"

orphans="$(comm -23 <(printf '%s\n' "$goldens") <(printf '%s\n' "$ci_projects") || true)"
if [ -n "$orphans" ]; then
  echo "Orphan visual goldens — these project dirs under ${prefix} are not run by any CI workflow:" >&2
  printf '  - %s\n' $orphans >&2
  echo >&2
  echo "Fix: add --project=<name> to a workflow under .github/workflows/, or remove the" >&2
  echo "stale goldens (regenerate via 'pnpm test:e2e:update' if the project comes back)." >&2
  exit 1
fi
echo "check_orphan_goldens: ok (goldens for: $(printf '%s ' $goldens))"
