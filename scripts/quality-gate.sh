#!/usr/bin/env bash
# Quality gate: run all checks required before PR.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Python lint ==="
uv run ruff check .

echo "=== Python format ==="
uv run ruff format --check .

echo "=== Python type check ==="
uv run mypy src/lizystudio/

echo "=== Python tests ==="
uv run pytest

echo "=== Frontend lint ==="
cd "$ROOT_DIR/frontend"
pnpm lint

echo "=== Frontend build ==="
pnpm build

echo ""
echo "All quality gates passed."
