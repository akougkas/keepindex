# KeepIndex portability brief

KeepIndex is private, local-first federated search intended to run on hardware its user controls. Portability means a fresh checkout starts with neutral defaults, makes every host-filesystem grant explicit, and fails locally when an optional provider is absent. It does not mean sending work to a hosted fallback.

## Supported installation boundaries

### Docker-first application

The ordinary user needs Docker Engine and the Compose plugin. `./start.sh` builds the application with Bun inside the image, starts KeepIndex and SearXNG, provisions a named `/data` volume, and publishes the PWA/API on host loopback. No host Bun installation is required. Compose pins SearXNG to the tested upstream release `2026.8.28-a30b2d474` and its multi-architecture OCI-index digest instead of following a mutable `latest` tag.

The base Compose stack does not mount a home directory, vault, browser profile, or arbitrary document folder. A user grants selected paths through an explicit override and should prefer read-only mounts. Inside the container, indexable paths remain under `/home/` or `/mnt/`; the SQLite database remains on `/data`.

The model runtime stays outside the base image. GPU backends, Apple MLX, model licenses, memory budgets, and model sizes vary too much for an honest universal image. Compose reaches an explicitly configured local provider through `host.docker.internal` or a private Compose service and remains useful in search mode when that provider is absent.

### Native development and administration

Native Bun remains supported for contributors and for the `keepidx` CLI. The Vite/Hono development server binds to `0.0.0.0` so a trusted LAN can use it; the Docker publication is loopback-only by default. Windows/WSL launchers discover their own checkout rather than embedding a username or path.

## Neutral defaults

- llama.cpp-compatible inference: `http://127.0.0.1:8080`.
- SearXNG: `http://127.0.0.1:8888`.
- UI/API and CLI URL: `http://localhost:5173`.
- No production model identifier. KeepIndex selects the first model advertised by the configured local provider unless `LLM_MODEL` is set.
- Fresh database: `server/keepindex.sqlite` natively or `/data/keepindex.sqlite` in Compose.
- Native storage opens or creates `server/keepindex.sqlite`; Compose uses `/data/keepindex.sqlite` on the named data volume.
- No personal usernames, home paths, private LAN addresses, machine nicknames, browser profiles, or recovery material are part of a default.

## Local inference portability

`KEEPINDEX_INFERENCE_PROVIDER=auto|openai-compatible|ollama` selects the local transport. The compatible transport covers llama.cpp, vLLM, SGLang, LM Studio, Lemonade, MLX-LM servers, compatible Ollama endpoints, and compatible frontends in front of NVIDIA Triton. Native Ollama discovery and chat are supported separately. Raw Triton tensor models require a model-specific ensemble or compatible frontend; KeepIndex does not guess tensor names and shapes.

Inference URLs are fail-closed. Loopback, RFC1918, private IPv6, single-label container names, `host.docker.internal`, and recognized local DNS suffixes are accepted. Public hosts, embedded credentials, query/fragment material, non-HTTP protocols, and public redirects are rejected. In particular, public OpenAI, Anthropic, and Google model endpoints cannot be configured as inference providers.

This restriction applies to inference. SearXNG intentionally makes web-source requests on the user's behalf, and the bounded source hydrator may retrieve exact allowlisted public documents without cookies. Neither receives the user's vault, browser-memory index, or complete evidence pack.

## One public namespace

Runtime configuration uses `KEEPINDEX_*`, browser keys use `keepindex-`, backups use `keepindex-state-backup`, and the CLI is `keepidx`. The first public release has no alternate namespace, alias, fallback variable, or prior backup schema. A fresh container therefore starts from one unambiguous identity and one canonical data volume.

## Platform assumptions still to address

### Native knowledge roots

`server/index.ts` permits roots under `/home/` and `/mnt/`. This supports Linux, WSL, and explicit container mounts but blocks native macOS paths under `/Users/`. A future rule must add macOS without weakening the invariant that `/api/knowledge/file` serves only a file contained by an indexed resource.

### Browser-history discovery

KeepIndex discovers common Linux and Windows/WSL Chrome, Edge, Brave, Chromium, and Firefox profiles. Native macOS discovery is not implemented. `KEEPINDEX_BROWSER_HISTORY_PATHS` is the explicit local escape hatch. Containers never receive a browser profile automatically; the operator must mount a selected database read-only.

### Document tooling

Text and code extraction are built in. PDF uses `pdftotext`; DOCX, ODT, RTF, and EPUB use Pandoc when installed. Container packaging and richer local-only OCR/layout/vision extraction need a separately approved design because they materially change image size, resource use, citation coordinates, and untrusted-document processing. Any such subsystem must be optional, isolated, and offline-capable.

### Obsidian and external knowledge tools

Direct read-only Obsidian indexing remains portable because it requires only files. An optional official-CLI adapter and a capability-scoped external-provider protocol are specified in `docs/ROADMAP.md` as KIX-24 through KIX-26. Notient is the planned first integration only after its read contract stabilizes; KeepIndex will not import its database or inherit write authority.

### Remote access

KeepIndex has no API authentication. Its loopback Docker publication is appropriate for one machine; LAN access requires a deliberate application bind and firewall policy. The SearXNG host port has an independent loopback-only bind, so exposing the application to a trusted LAN does not expose SearXNG with it. Authenticated remote access and a reverse-proxy deployment profile are future work. `https://keepindex.ing` is the public project identity, not a claim that the private API is hosted there.

## Security invariants

Portability work must not weaken:

- the private-origin CORS allowlist and prohibition on wildcard CORS;
- loopback-only container publication by default;
- local-only inference endpoint and redirect enforcement;
- credential-file exclusion during indexing;
- URL credential stripping during browser-history import;
- indexed-root containment for local file reads;
- request-size, provider-retry, evidence-pack, hydration, and diversity budgets;
- prompt-injection treatment of retrieved text;
- durable query records, actual-model reporting, citation validation, and the post-generation grounding gate;
- explicit degraded behavior when SearXNG or local inference is unavailable.

## Verification

```bash
bun run typecheck
bun test server src
bun run build
bun run test:e2e
```

The suite is offline. Do not casually run `bun run test:corpus`; it spends real SearXNG request budget tracked under KIX-18 in `docs/ROADMAP.md`.
