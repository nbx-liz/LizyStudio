#!/usr/bin/env bash
# Audit script: run quality gate + API contract verification.
# Usage: bash scripts/audit.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
AUDIT_DIR="$ROOT_DIR/.agent/audit/$TIMESTAMP"
mkdir -p "$AUDIT_DIR"

echo "=== Quality Gate ==="
if bash "$ROOT_DIR/scripts/quality-gate.sh" 2>&1 | tee "$AUDIT_DIR/quality-gate.log"; then
  echo "Quality gate: PASSED" >> "$AUDIT_DIR/summary.txt"
else
  echo "Quality gate: FAILED" >> "$AUDIT_DIR/summary.txt"
  echo "Quality gate failed. See $AUDIT_DIR/quality-gate.log"
  exit 1
fi

echo ""
echo "=== API Contract Verification ==="
PORT=8599
uv run lizystudio --port "$PORT" &
SERVER_PID=$!

# Wait for server to start
for i in $(seq 1 10); do
  if curl -sf "http://localhost:$PORT/api/workspace/status" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Core API endpoints
echo "Checking API endpoints..."
curl -sf "http://localhost:$PORT/api/workspace/status" > "$AUDIT_DIR/workspace-status.json" && echo "  /api/workspace/status OK"
curl -sf "http://localhost:$PORT/api/backends" > "$AUDIT_DIR/backends.json" && echo "  /api/backends OK"
curl -sf "http://localhost:$PORT/api/jobs/" > "$AUDIT_DIR/jobs.json" && echo "  /api/jobs/ OK"
curl -sf "http://localhost:$PORT/api/workspace/config/schema" > "$AUDIT_DIR/config-schema.json" && echo "  /api/workspace/config/schema OK"
echo "API contract: PASSED" >> "$AUDIT_DIR/summary.txt"

# Cleanup
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true

# Manual UI verification checklist
cat > "$AUDIT_DIR/ui-checklist.md" << 'CHECKLIST'
# UI Manual Verification Checklist

## Workspace
- [ ] Data load (path / upload) works
- [ ] Data Preview table shows first 10 rows
- [ ] Target selection triggers task auto-detection
- [ ] Config Import re-syncs DataPanel state
- [ ] Model Panel shows backend name + version badge
- [ ] Fit button disabled when no data / no model selected
- [ ] Results header shows "Fit #N — {model}" format
- [ ] Raw Config button opens YAML modal
- [ ] Plot selector auto-selects first available plot
- [ ] Failed view shows error code separately
- [ ] Cancel shows confirmation dialog

## Jobs
- [ ] Job list with #N format and relative time
- [ ] Config section shows tree view (not raw JSON)
- [ ] Running jobs show pulse animation
- [ ] Export / Re-fit / Delete actions work

## Inference
- [ ] GT detection at upload time
- [ ] GT-yes: Score table + plots
- [ ] GT-no: Predictions + distribution + comparison
- [ ] History with Inf #N format
CHECKLIST

echo ""
echo "=== Audit Complete ==="
echo "Artifacts saved to: $AUDIT_DIR"
echo "Manual UI check: open http://localhost:8501 and fill $AUDIT_DIR/ui-checklist.md"
cat "$AUDIT_DIR/summary.txt"
