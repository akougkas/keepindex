# Static product website on Blade

This deploys **keepindex.ing**, the public KeepIndex product site. The personal application is installed on ZBook, with its sources, index, SearXNG, and local AI on that computer. Do not deploy the repository-root application Compose stack to Blade.

## Build and deploy

From the repository root:

```bash
./website/keepindexing/deploy/deploy-blade.sh
```

The script checks and builds Astro locally, stages static assets at `blade:~/webhosting/keepindex-site`, builds an nginx image, and waits for the site container to become healthy. The previous container serves its existing image during staging. Container replacement can briefly interrupt requests; this is not a zero-downtime deployment.

The container is read-only apart from ephemeral nginx runtime directories. It joins the existing external `web` network. Traefik routes `keepindex.ing` and `www.keepindex.ing` to nginx port 80. The diagnostic host port is loopback-only `127.0.0.1:8085`. There is no private data volume or inference configuration in this stack. Unknown paths return an actual 404, and www redirects to the apex over HTTPS.

## Cloudflare Tunnel and DNS

The existing `blade-tunnel` ID is **246390fe-64ff-4cee-89db-4754247c03c6**. It is a routing identifier, not a credential. The tunnel's credential file stays on Blade.

Before the final catch-all ingress rule in `/etc/cloudflared/config.yml`, add:

```yaml
  - hostname: keepindex.ing
    service: http://localhost:80
  - hostname: www.keepindex.ing
    service: http://localhost:80
```

Preserve all existing workbench routes. Validate with `sudo cloudflared tunnel ingress validate`, then restart only `cloudflared`. Add the site to `/usr/local/sbin/blade-webhosting-up` with `compose_up "$WEBHOST_ROOT/keepindex-site"`. The old KeepIndex application entry must remain removed.

In Cloudflare, select the **keepindex.ing** zone → **DNS → Records**:

| Type | Name | Target | Proxy | TTL |
| --- | --- | --- | --- | --- |
| CNAME | `@` | `246390fe-64ff-4cee-89db-4754247c03c6.cfargotunnel.com` | Proxied (orange cloud) | Auto |
| CNAME | `www` | `246390fe-64ff-4cee-89db-4754247c03c6.cfargotunnel.com` | Proxied (orange cloud) | Auto |

Replace conflicting records for those exact names if present. Cloudflare flattens the apex CNAME automatically. Do not enter Blade's LAN or Tailscale IP: Cloudflare reaches it through the existing outbound tunnel. The zone already delegates to `magali.ns.cloudflare.com` and `owen.ns.cloudflare.com`; no registrar nameserver change is needed while that delegation remains correct.

This is a public product site, so no Cloudflare Access login should cover these hostnames. Check that Edge Certificates shows an active certificate for the domain. `.ing` is HTTPS-only in modern browsers. Keep Rocket Loader and automatic script injection off; the site has a restrictive self-only script policy.

## Verification and rollback

```bash
ssh blade 'cd ~/webhosting/keepindex-site && docker compose ps'
ssh blade 'curl -fsSI -H "Host: keepindex.ing" http://127.0.0.1/'
curl -fsSI https://keepindex.ing/
curl -sSI https://www.keepindex.ing/docs/
```

The apex should return 200 with TLS; www should redirect to the same path on the apex. Check `/docs/`, `/privacy/`, and a nonexistent path (404). A local nginx success does not prove public DNS or certificates are ready.

To roll back, check out the desired website revision in a separate worktree and redeploy its build. To retire only the site, run `docker compose down` in `~/webhosting/keepindex-site` and remove its boot entry and exact tunnel routes. Preserve unrelated Blade services and routes.

## Retired application

The application containers and their automatic startup entry were removed on 2026-09-11. Original named volumes and backups were retained. Active application gateway credentials and overrides were moved to protected retirement backups. A narrow firewall allowance added for the previous application's Blade AI gateway access was removed. Retained volumes are an archive, not an active search deployment.
