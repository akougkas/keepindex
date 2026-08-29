#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONVERT_BIN="${CONVERT_BIN:-convert}"

command -v bun >/dev/null 2>&1 || {
  echo "Bun is required to regenerate KeepIndex vector assets." >&2
  exit 1
}

command -v "$CONVERT_BIN" >/dev/null 2>&1 || {
  echo "ImageMagick is required to regenerate KeepIndex raster icons." >&2
  exit 1
}

bun "$PROJECT_DIR/scripts/generate-brand-vectors.mjs"

mkdir -p "$PROJECT_DIR/public/icons"

render_icon() {
  local source_path="$1"
  local size="$2"
  local output_path="$3"
  "$CONVERT_BIN" -background none -density 384 "$source_path" -resize "${size}x${size}" -depth 8 -strip "$output_path"
}

render_icon "$PROJECT_DIR/public/keepindex-icon.svg" 192 "$PROJECT_DIR/public/icons/keepindex-192.png"
render_icon "$PROJECT_DIR/public/keepindex-icon.svg" 512 "$PROJECT_DIR/public/icons/keepindex-512.png"
render_icon "$PROJECT_DIR/public/keepindex-maskable-icon.svg" 512 "$PROJECT_DIR/public/icons/keepindex-maskable-512.png"
render_icon "$PROJECT_DIR/public/keepindex-icon.svg" 180 "$PROJECT_DIR/public/icons/apple-touch-icon.png"

identify "$PROJECT_DIR/public/icons/keepindex-192.png" \
  "$PROJECT_DIR/public/icons/keepindex-512.png" \
  "$PROJECT_DIR/public/icons/keepindex-maskable-512.png" \
  "$PROJECT_DIR/public/icons/apple-touch-icon.png"
