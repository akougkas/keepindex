#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export KEEPINDEX_E2E_PORT="${KEEPINDEX_E2E_PORT:-5174}"
if [[ ! "$KEEPINDEX_E2E_PORT" =~ ^[0-9]+$ ]] \
  || (( KEEPINDEX_E2E_PORT < 1024 || KEEPINDEX_E2E_PORT > 65535 )); then
  echo "KEEPINDEX_E2E_PORT must be an integer from 1024 through 65535." >&2
  exit 2
fi

KEEPINDEX_E2E_ORIGIN="http://127.0.0.1:${KEEPINDEX_E2E_PORT}"
KEEPINDEX_E2E_LOG="/tmp/keepindex-playwright-vite-${KEEPINDEX_E2E_PORT}.log"
KEEPINDEX_E2E_SERVER_PID=""

cleanup() {
  if [[ -n "$KEEPINDEX_E2E_SERVER_PID" ]]; then
    kill -TERM -- "-$KEEPINDEX_E2E_SERVER_PID" 2>/dev/null || true
    sleep 0.2
    kill -KILL -- "-$KEEPINDEX_E2E_SERVER_PID" 2>/dev/null || true
    wait "$KEEPINDEX_E2E_SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Never reuse a different local product. This is especially important for
# developers who already run another installation on KeepIndex's user port.
if curl --connect-timeout 1 --max-time 2 -fsS "$KEEPINDEX_E2E_ORIGIN/" >/dev/null 2>&1; then
  echo "KeepIndex E2E port ${KEEPINDEX_E2E_PORT} is already serving another process." >&2
  exit 1
fi

setsid bun --bun vite --host 127.0.0.1 --port "$KEEPINDEX_E2E_PORT" --strictPort >"$KEEPINDEX_E2E_LOG" 2>&1 &
KEEPINDEX_E2E_SERVER_PID=$!
for _ in {1..40}; do
  if curl --connect-timeout 1 --max-time 2 -fsS "$KEEPINDEX_E2E_ORIGIN/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
if ! curl --connect-timeout 1 --max-time 2 -fsS "$KEEPINDEX_E2E_ORIGIN/" >/dev/null; then
  echo "KeepIndex E2E server did not start; see ${KEEPINDEX_E2E_LOG}." >&2
  exit 1
fi

bunx playwright test "$@"
