#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE=${REMOTE:-blade}
REMOTE_DIR=${REMOTE_DIR:-/home/akougkas/webhosting/keepindex-site}

echo "==> Checking and building KeepIndex website..."
npm --prefix "$SITE_DIR" run check
npm --prefix "$SITE_DIR" run build

echo "==> Ensuring remote directory exists on $REMOTE ($REMOTE_DIR)..."
ssh "$REMOTE" "mkdir -p '$REMOTE_DIR/dist'"

echo "==> Syncing compose.yml and nginx.conf..."
rsync -avz "$SCRIPT_DIR/compose.yml" "$REMOTE:$REMOTE_DIR/compose.yml"
rsync -avz "$SCRIPT_DIR/nginx.conf" "$REMOTE:$REMOTE_DIR/nginx.conf"

echo "==> Syncing build assets to $REMOTE..."
rsync -avz --delete "$SITE_DIR/dist/" "$REMOTE:$REMOTE_DIR/dist/"

echo "==> Starting/updating keepindex-site container on $REMOTE..."
ssh "$REMOTE" "cd '$REMOTE_DIR' && docker compose up -d"

echo "==> Testing local health endpoint on $REMOTE..."
ssh "$REMOTE" "curl -sI http://127.0.0.1:8085/ | head -n 5"

echo "==> Testing Traefik routing on $REMOTE for Host: keepindex.ing..."
ssh "$REMOTE" "curl -sI -H 'Host: keepindex.ing' http://127.0.0.1:80/ | head -n 5"

echo "==> KeepIndex website successfully deployed to $REMOTE!"
