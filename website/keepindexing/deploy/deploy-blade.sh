#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE=${REMOTE:-blade}
REMOTE_DIR=${REMOTE_DIR:-/home/akougkas/webhosting/keepindex-site}
[[ "$REMOTE" =~ ^[a-zA-Z0-9_.@-]+$ && "$REMOTE_DIR" =~ ^/[a-zA-Z0-9_./-]+$ ]] || {
  echo 'Use a simple SSH host alias and absolute deployment directory.' >&2; exit 2;
}

npm --prefix "$SITE_DIR" run check
npm --prefix "$SITE_DIR" run build
ssh "$REMOTE" "mkdir -p '$REMOTE_DIR/dist'"
rsync -az "$SCRIPT_DIR/compose.yml" "$SCRIPT_DIR/nginx.conf" "$SCRIPT_DIR/Dockerfile" "$REMOTE:$REMOTE_DIR/"
# The running container serves its built image, so staging new assets cannot mix releases.
rsync -az --delete "$SITE_DIR/dist/" "$REMOTE:$REMOTE_DIR/dist/"
ssh "$REMOTE" "cd '$REMOTE_DIR' && docker compose up -d --build --wait --wait-timeout 60"
ssh "$REMOTE" "curl -fsS -o /dev/null http://127.0.0.1:8085/ && curl -fsS -o /dev/null -H 'Host: keepindex.ing' http://127.0.0.1/"
echo 'Static site deployed and checked through nginx and Traefik. Public DNS/TLS is a separate check.'
