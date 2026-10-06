#!/usr/bin/env bash
set -euo pipefail

# run_compat.sh -- Run MCP compatibility test suite.
#
# Starts the MCP server in the background, runs protocol and compatibility
# tests, reports results, then shuts the server down.
#
# Usage:
#   ./test/compatibility/run_compat.sh [--server-url URL] [--verbose]
#
# If --server-url is provided, skips server spawn/kill and tests against
# the given URL directly.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_JS="$REPO_ROOT/server.js"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
EXTERNAL_URL=""
VERBOSE=""
PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url)
      EXTERNAL_URL="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE="--verbose"
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Cleanup function
# ---------------------------------------------------------------------------
SERVER_PID=""
SERVER_LOG=""

# Idempotent: runs on normal exit and on INT/TERM, so the server never
# outlives this script (132.119).
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    echo ""
    echo "Stopping server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
    echo "Server stopped."
  fi
  if [[ -n "$SERVER_LOG" ]]; then rm -f "$SERVER_LOG"; SERVER_LOG=""; fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

# ---------------------------------------------------------------------------
# Start server (unless external URL provided)
# ---------------------------------------------------------------------------
if [[ -z "$EXTERNAL_URL" ]]; then
  # PORT=0: the OS picks a free port on loopback and the server prints it, so
  # two runs (or anything else on the machine) cannot collide on a port.
  SERVER_LOG="$(mktemp)"
  echo "=== Starting MCP server on a free port ==="
  PORT=0 BIND_HOST=127.0.0.1 node "$SERVER_JS" >"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  # Wait for the startup line (up to 15 seconds), then for /health.
  PORT=""
  RETRIES=30
  while [[ $RETRIES -gt 0 ]]; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "ERROR: server exited before it was ready:"
      cat "$SERVER_LOG"
      exit 1
    fi
    PORT="$(sed -n 's|.*listening on http://[^:]*:\([0-9][0-9]*\).*|\1|p' "$SERVER_LOG" | head -1)"
    if [[ -n "$PORT" ]] && curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
      echo "Server is ready on port $PORT (PID $SERVER_PID)."
      break
    fi
    sleep 0.5
    RETRIES=$((RETRIES - 1))
  done

  if [[ $RETRIES -eq 0 ]]; then
    echo "ERROR: Server failed to start within 15 seconds."
    cat "$SERVER_LOG"
    exit 1
  fi
  BASE_URL="http://127.0.0.1:$PORT"
else
  BASE_URL="$EXTERNAL_URL"
  echo "=== Testing against external server: $BASE_URL ==="
fi

echo ""

# ---------------------------------------------------------------------------
# Run tests
# ---------------------------------------------------------------------------
PROTOCOL_EXIT=0
COMPAT_EXIT=0

echo "=== Running protocol_test.js ==="
echo ""
if node "$SCRIPT_DIR/protocol_test.js" --server-url "$BASE_URL" $VERBOSE; then
  echo ""
  echo "protocol_test.js: PASSED"
else
  PROTOCOL_EXIT=$?
  echo ""
  echo "protocol_test.js: FAILED (exit code $PROTOCOL_EXIT)"
fi

echo ""
echo "=== Running mcp_compat_test.js ==="
echo ""
if node "$SCRIPT_DIR/mcp_compat_test.js" --server-url "$BASE_URL" $VERBOSE; then
  echo ""
  echo "mcp_compat_test.js: PASSED"
else
  COMPAT_EXIT=$?
  echo ""
  echo "mcp_compat_test.js: FAILED (exit code $COMPAT_EXIT)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "  Compatibility Test Summary"
echo "=========================================="
echo "  protocol_test.js:   $([ $PROTOCOL_EXIT -eq 0 ] && echo 'PASS' || echo 'FAIL')"
echo "  mcp_compat_test.js: $([ $COMPAT_EXIT -eq 0 ] && echo 'PASS' || echo 'FAIL')"
echo "=========================================="

if [[ $PROTOCOL_EXIT -ne 0 || $COMPAT_EXIT -ne 0 ]]; then
  exit 1
fi
