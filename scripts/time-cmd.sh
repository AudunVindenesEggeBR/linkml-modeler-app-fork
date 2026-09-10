#!/usr/bin/env bash
# Wraps an arbitrary command with start/end/duration timing, appending one
# line per invocation to a shared log (default: test-timing/containers.log
# at the repo root; override with TIME_CMD_LOG). Used to instrument slow,
# hard-to-profile steps (container calls, pre-push test runs) so their
# wall-clock cost is visible without re-running under a separate profiler.
#
# Usage: scripts/time-cmd.sh <label> -- <command...>
set -euo pipefail

if [ "$#" -lt 3 ] || [ "$2" != "--" ]; then
  echo "Usage: $0 <label> -- <command...>" >&2
  exit 1
fi

LABEL="$1"
shift 2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${TIME_CMD_LOG:-$SCRIPT_DIR/test-timing/containers.log}"
mkdir -p "$(dirname "$LOG_FILE")"

START_EPOCH=$(date +%s)
START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

set +e
"$@"
STATUS=$?
set -e

END_EPOCH=$(date +%s)
DURATION=$((END_EPOCH - START_EPOCH))

printf '%s  label=%-20s duration=%5ss  exit=%s  cmd=%s\n' \
  "$START_ISO" "$LABEL" "$DURATION" "$STATUS" "$*" >> "$LOG_FILE"

exit "$STATUS"
