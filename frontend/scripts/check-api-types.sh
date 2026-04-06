#!/bin/bash
# CI check: verify generated API types are in sync with the backend OpenAPI schema.
# Usage: bash scripts/check-api-types.sh
#
# Requires the backend dev server running on localhost:8501.
# In CI, start the server before invoking this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$FRONTEND_DIR"

echo "Regenerating API types from OpenAPI schema..."
pnpm generate:api

if ! git diff --exit-code src/api/generated/; then
  echo ""
  echo "ERROR: Generated API types are out of date."
  echo "Run 'cd frontend && pnpm generate:api' and commit the result."
  exit 1
fi

echo "API types are up to date."
