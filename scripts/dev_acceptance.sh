#!/usr/bin/env bash
# dev_acceptance — check that a machine (or a sandbox) can develop LizyStudio.
#
# Clones this repository into WORKDIR at REV, performs the one-time setup in
# the order of CONTRIBUTING.md § Getting started, then runs every documented
# check. One line per step goes to stdout and to WORKDIR/summary.txt:
#
#   STEP <name> PASS|FAIL <seconds>s
#
# and each step's output goes to WORKDIR/logs/<name>.log. A step that fails
# does not stop the run, so one run shows every broken step at once.
#
# Usage:
#   scripts/dev_acceptance.sh WORKDIR [REV] [LABEL]
#
#   WORKDIR  a directory that does not exist yet; its parent must exist. The
#            script never deletes anything, so use a new WORKDIR for each run.
#            Inside a sandbox it must be writable there.
#   REV      the revision of this repository to check (default origin/develop).
#            Run `git fetch` beforehand, outside any sandbox.
#   LABEL    a free-text label for the summary header (default: the host name).
#
# How to run it in each environment is in CONTRIBUTING.md § Checking a new
# machine. `pnpm generate:api` is not run: it needs a running backend, and CI
# checks the generated types (api-types-drift).
#
# Exit 0 = every step passed, 1 = at least one step failed, 2 = usage error.
set -uo pipefail

if [ $# -lt 1 ] || [ $# -gt 3 ]; then
  echo "usage: scripts/dev_acceptance.sh WORKDIR [REV] [LABEL]  (see the header of this script)" >&2
  exit 2
fi
work=$1
rev=${2:-origin/develop}
label=${3:-$(hostname)}
src=$(git -C "$(dirname "$0")" rev-parse --show-toplevel) || exit 2

commit=$(git -C "$src" rev-parse --verify --quiet "$rev^{commit}") || {
  echo "dev_acceptance: unknown revision: $rev" >&2
  exit 2
}
# Refuse rather than replace: the script never deletes a directory.
mkdir "$work" 2>/dev/null || {
  echo "dev_acceptance: cannot create $work: it already exists or its parent is missing; use a new WORKDIR" >&2
  exit 2
}
# Absolute from here on: the steps below change into the clone.
work=$(cd "$work" && pwd) || exit 2
mkdir "$work/logs" || exit 2
logs=$work/logs
summary=$work/summary.txt
: > "$summary"
failed=0

step() {
  local name=$1; shift
  local t0=$SECONDS r
  if "$@" >"$logs/$name.log" 2>&1; then r=PASS; else r=FAIL; failed=1; fi
  printf 'STEP %-24s %s %ss\n' "$name" "$r" $((SECONDS - t0)) | tee -a "$summary"
}

echo "== $label  $rev ($commit)  $(date -u +%FT%TZ)" | tee -a "$summary"

# --- one-time setup, in the CONTRIBUTING.md order ---
# A local clone copies the object store, so any commit of the source is there.
step clone             bash -c 'git clone --quiet --no-checkout "$1" "$2" && git -C "$2" checkout --quiet --detach "$3"' _ "$src" "$work/repo" "$commit"
cd "$work/repo" || exit 1
step python-version    bash -c 'uv python find >/dev/null && cat .python-version'
step uv-sync-locked    uv sync --locked
step venv-python       bash -c 'want=$(cat .python-version); .venv/bin/python -c "import sys; v=\"%d.%d\" % sys.version_info[:2]; assert v == sys.argv[1], v; print(v)" "$want"'
step node-version      bash -c 'want=$(cat .nvmrc); node -v | grep -q "^v$want\." && node -v'
# CONTRIBUTING runs `corepack enable` once per Node installation. Run it here
# only when no pnpm is on PATH yet: it writes shims next to Node, which a
# sandbox may not allow even though the shims already exist. pnpm-version then
# checks that the pnpm found is the pinned one.
step corepack-enable   bash -c 'command -v pnpm >/dev/null || corepack enable'
step pnpm-version      bash -c 'cd frontend && want=$(sed -n "s/.*\"packageManager\": *\"pnpm@\([^\"]*\)\".*/\1/p" package.json) && test -n "$want" && test "$(pnpm --version)" = "$want" && echo "$want"'
step pnpm-install      bash -c 'cd frontend && pnpm install --frozen-lockfile'
step playwright-inst   bash -c 'cd frontend && pnpm exec playwright install chromium'
step precommit-install uv run pre-commit install

# --- documented checks ---
step ruff-check        uv run ruff check .
step ruff-format       uv run ruff format --check .
step mypy              uv run mypy src/lizystudio/
step pytest            uv run pytest -q -p no:cacheprovider --ignore=tests/integration
step pytest-integ      uv run pytest -q -p no:cacheprovider tests/integration
step precommit-all     uv run pre-commit run --all-files
step pnpm-check        bash -c 'cd frontend && pnpm check'
step pnpm-test         bash -c 'cd frontend && pnpm test'
step pnpm-build        bash -c 'cd frontend && pnpm build'
step e2e-functional    bash -c 'cd frontend && pnpm exec playwright test --project=chromium --grep-invert "@visual|@a11y|@ci-flaky" --ignore-snapshots --retries 0 --reporter=line'
# Nothing above may leave a tracked change or a non-ignored untracked file.
# Ignored output (.venv, tool caches) is expected and is not checked.
step tree-clean        bash -c 'out=$(git status --porcelain) || exit 1; test -z "$out" || { printf "%s\n" "$out"; exit 1; }'

echo "== done $(date -u +%FT%TZ)" | tee -a "$summary"
exit $failed
