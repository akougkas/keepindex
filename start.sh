#!/usr/bin/env bash
set -Eeuo pipefail

KEEPINDEX_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$KEEPINDEX_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "[keepindex] Docker is required. Install Docker Desktop or Docker Engine first." >&2
  exit 127
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "[keepindex] The Docker Compose plugin is required (docker compose)." >&2
  exit 127
fi
if ! docker info >/dev/null 2>&1; then
  echo "[keepindex] Docker is installed, but its daemon is not available." >&2
  exit 1
fi

KEEPINDEX_LOCAL_PORT="${KEEPINDEX_PORT:-5173}"
echo "[keepindex] Search your world. Keep it yours."
echo "[keepindex] Bootstrapping the private local stack..."
echo "[keepindex] PWA: http://localhost:${KEEPINDEX_LOCAL_PORT}"
echo "[keepindex] Press Ctrl+C to stop KeepIndex. Persistent data remains in its Docker volume."

exec docker compose up --build --remove-orphans
