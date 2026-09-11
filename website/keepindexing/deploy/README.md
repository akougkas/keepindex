# KeepIndex Website Deployment Guide

This directory contains the production deployment configuration for `keepindex.ing` on the homelab web edge node `blade`.

## Architecture Overview

- **Host Node**: `blade` (`192.168.86.140`, Tailscale `100.124.181.9`).
- **Web Edge Proxy**: Standalone Traefik on Docker network `web`.
- **Runtime**: Ultra-lightweight `nginx:alpine` container serving pre-compiled static assets from `dist/`.
- **Direct Debug Port**: `127.0.0.1:8085` on blade.
- **Ingress**: Traefik intercepts `Host: keepindex.ing` and `Host: www.keepindex.ing` on port 80/443 and routes to container port 80.
- **Edge Ingress / DNS**: Cloudflare Tunnel (`blade-tunnel`) or direct public DNS to edge proxy.

## Files

- `nginx.conf`: Nginx configuration with clean URL rewriting for Astro static pages, gzip compression, 1-year immutable caching for `/_astro/*`, 30-day caching for assets/fonts, security headers (`nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, `Permissions-Policy`), and custom 404 handler.
- `compose.yml`: Docker Compose stack definition attaching to external network `web` with Traefik routing labels.
- `Dockerfile`: Multi-stage build definition for building standalone container images.
- `deploy-blade.sh`: Zero-downtime deployment script that builds locally on zbook, rsyncs `dist/` and configs to blade, starts the container, and verifies both container and Traefik responses.

## Deployment Instructions

### 1. One-Command Deploy

From the repository:

```bash
cd website/keepindexing
./deploy/deploy-blade.sh
```

### 2. Cloudflare Ingress Configuration

To connect `keepindex.ing` to blade's Cloudflare tunnel (`blade-tunnel`):

1. **DNS Zone (`keepindex.ing`)**:
   - `CNAME @ -> 246390fe-64ff-4cee-89db-4754247c03c6.cfargotunnel.com` (Proxied: Orange Cloud)
   - `CNAME www -> 246390fe-64ff-4cee-89db-4754247c03c6.cfargotunnel.com` (Proxied: Orange Cloud)

2. **Tunnel Configuration (`/etc/cloudflared/config.yml` on blade)**:
   Add the following entries before the catch-all `http_status:404`:

   ```yaml
     - hostname: "keepindex.ing"
       service: http://localhost:80
     - hostname: "www.keepindex.ing"
       service: http://localhost:80
   ```

   *Note: In accordance with homelab policy, verify `/etc/cloudflared/config.yml` syntax before restarting cloudflared.*

3. **Homelab Boot Convergence**:
   Add `compose_up "$WEBHOST_ROOT/keepindex-site"` to `/usr/local/sbin/blade-webhosting-up` on blade to ensure the site converges automatically on system boot.
