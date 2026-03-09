#!/usr/bin/env bash
# Build script: frontend + Python package.
#
# Usage:
#   ./scripts/build.sh          # build everything
#   ./scripts/build.sh frontend # frontend only
#   ./scripts/build.sh python   # Python package only
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

build_frontend() {
    echo "=== Building frontend ==="
    cd "$ROOT_DIR/frontend"
    pnpm install --frozen-lockfile
    pnpm build
    echo "Frontend built → src/lizystudio/static/"
}

build_python() {
    echo "=== Building Python package ==="
    cd "$ROOT_DIR"
    uv build --wheel
    echo "Python package built → dist/"
}

case "${1:-all}" in
    frontend) build_frontend ;;
    python)   build_python ;;
    all)
        build_frontend
        build_python
        ;;
    *)
        echo "Usage: $0 [frontend|python|all]"
        exit 1
        ;;
esac

echo "=== Done ==="
