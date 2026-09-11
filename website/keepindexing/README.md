# KeepIndex product website

The static website for [keepindex.ing](https://keepindex.ing), built with Astro and the Lumos for Astro component framework. It describes a single-computer product: selected local files, browser history, local or explicitly selected remote AI, and a local SearXNG container. It has no application API, device pairing, private index, or inference credentials.

## Develop and verify

Node 22.12 or newer is required.

```bash
npm ci
npm run check
npm run build
npm run preview -- --host 127.0.0.1
```

Follow [AGENTS.md](AGENTS.md) and [LUMOS.md](LUMOS.md) for component and styling conventions. The design uses local Bricolage Grotesque and Figtree fonts, ink/ivory surfaces, and green accents. The interactive search example uses static sample data and never contacts a local KeepIndex installation.

The route pages are in `src/pages`; shared guide, architecture, demo, and command components own their styles and behavior. The public site uses the Apache-2.0 KeepIndex product identity; the underlying Lumos framework retains its upstream [MIT license](LICENSE).

## Deploy

See [deploy/README.md](deploy/README.md). The deployment copies only the static build and nginx configuration to Blade and builds a separate `keepindex-site` image. It does not deploy the private application.
