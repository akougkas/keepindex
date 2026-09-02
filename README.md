<p align="center">
  <img src="assets/brand/keepindex-lockup.svg" width="900" alt="keepindex — Search your world. Keep it yours. — keepindex.ing" />
</p>

# KeepIndex

**Search your world. Keep it yours.**

KeepIndex is private, local-first federated search. It brings self-hosted web results together with an Obsidian vault, local documents, and opt-in browser history, then uses a model running on hardware you control to produce grounded answers with inspectable citations.

There is no hosted KeepIndex account, analytics collector, telemetry export, cloud-inference fallback, or third-party tracking pixel. Search history, settings, indexed knowledge, imported browser metadata, and durable evidence records remain in your browser and local SQLite database.

## Start with Docker

Docker Engine with the Compose plugin is the only prerequisite for the ordinary installation path.

```bash
git clone https://github.com/akougkas/keepindex.git
cd keepindex
./start.sh
```

That one launcher builds the KeepIndex application with Bun inside its container, starts the private UI/API and SearXNG, provisions a named SQLite data volume, and exposes the installable web app at [http://127.0.0.1:5173](http://127.0.0.1:5173). Stop it with `Ctrl+C`; Compose forwards the signal cleanly.

Browsers treat loopback as a secure context, so the PWA can be installed from that local URL. The application and API also render over deliberately enabled private-LAN HTTP, including in browsers without `crypto.randomUUID`; service-worker installation on a non-loopback device still requires HTTPS because that is a browser security rule.

You can use the equivalent Compose command directly:

```bash
docker compose up --build
```

Search remains useful while the model provider is offline. Grounded answer and research modes report that local inference is unavailable instead of sending the request elsewhere.

## What it searches

| Source | Retrieval path | Privacy boundary |
| --- | --- | --- |
| Web | Your self-hosted SearXNG instance | SearXNG makes the web requests; KeepIndex receives result metadata |
| Obsidian vaults | Local text extraction and BM25 ranking | Explicitly indexed paths only |
| Local documents and code | Local extraction, chunking, filters, and BM25 | Explicitly indexed paths only; credential-like files are excluded |
| Browser history | Opt-in local FTS5 index | URL/title/visit metadata only; credentials are stripped before storage |

Results are admitted, deduplicated, ranked, and fused before any generation. Answer and research prompts receive a bounded evidence pack. Citation identifiers and sentence-level coverage are validated after generation; a response with an out-of-pack identifier, no resolved citation, or less than 80% coverage after bounded repair is recorded as `no_evidence` rather than presented as a grounded success.

## Architecture

```text
SearXNG web results ───────────────┐
Obsidian vault chunks ────────────┤
Local documents and code ────────┼─> admission + ranking + fusion
Opt-in browser-history metadata ─┘              │
                                                v
                                   bounded evidence pack
                                                │
                                                v
                                  local inference provider
                                                │
                                                v
                                  grounding + citation gate
                                                │
                                                v
                                  local UI and SQLite record
```

The browser UI and Hono API run together on port `5173`. SQLite uses WAL mode for search history, collections, sessions, knowledge chunks, browser-memory metadata, and durable per-query evidence records. The application shell is an installable PWA with a clean `keepindex` cache namespace.

## Local inference only

KeepIndex refuses public inference endpoints. Prompt or evidence traffic cannot be configured to go to OpenAI, Anthropic, Google, or another public model API. Accepted inference URLs must be loopback, RFC1918, private IPv6, a local/container hostname, or a recognized local DNS suffix. Redirects from a permitted local endpoint to the public internet are rejected.

The provider layer supports local engines through two transports:

| Engine | KeepIndex transport | Notes |
| --- | --- | --- |
| llama.cpp | OpenAI-compatible | Default endpoint is `http://127.0.0.1:8080` outside Docker |
| vLLM | OpenAI-compatible | Point `LLM_URL` at the local server root |
| SGLang | OpenAI-compatible | Uses advertised model identifiers |
| LM Studio | OpenAI-compatible | Enable its local server; no cloud fallback |
| Lemonade | OpenAI-compatible | Use its locally exposed compatible endpoint |
| MLX-LM / MLX servers | OpenAI-compatible | Suitable for Apple silicon local inference |
| Ollama | Native or OpenAI-compatible | Native discovery/chat is selected with `KEEPINDEX_INFERENCE_PROVIDER=ollama` |
| NVIDIA Triton | Compatible frontend or ensemble | Raw Triton tensor graphs have model-specific schemas; expose an OpenAI-compatible local frontend rather than pretending arbitrary graphs share a chat contract |

With `KEEPINDEX_INFERENCE_PROVIDER=auto`, KeepIndex discovers a compatible local transport. `openai-compatible` and `ollama` select one explicitly. When no model is configured, KeepIndex selects the first model advertised by the local server. `LLM_MODEL` and `LLM_FALLBACK_MODEL` may pin advertised identifiers; production has no hardcoded model name.

The protocol name “OpenAI-compatible” describes a local wire format only. KeepIndex neither links to nor accepts the public OpenAI service.

### Connect a host model server from Docker

Compose points the application container at `host.docker.internal:8080` by default. Start a local provider on the host and make it reachable from Docker. For llama.cpp, one typical shape is:

```bash
llama-server --host 0.0.0.0 --port 8080 --model /path/to/your-model.gguf
```

Restrict that listener with the host firewall. KeepIndex does not choose or download a multi-gigabyte model automatically because hardware backends, licenses, memory limits, and model preferences differ.

## The `keepidx` CLI

`keepidx` is a small Bun/TypeScript administration CLI rather than a decorative wrapper.

```text
keepidx help             command summary
keepidx version          package version
keepidx start            start KeepIndex and SearXNG with Compose
keepidx doctor           check prerequisites, ports, paths, and local providers
keepidx status           concise health summary
keepidx status --json    stable JSON health output
keepidx open             open the configured local UI, or print its URL
```

The Docker-only quick start does not require Bun on the host. Contributors or administrators who want the native CLI can install Bun and link this checkout:

```bash
bun install --frozen-lockfile
bun link
keepidx help
```

Every command accepts `--help`. URL resolution is deterministic:

```text
--url > KEEPINDEX_URL > http://localhost:5173
```

## Index local knowledge

The Docker container cannot see host files unless you explicitly mount them. This is intentional. Copy `compose.override.example.yml`, choose the host paths you want to expose, and mount them read-only under `/home/keepindex/knowledge` or `/mnt/...`. Then add the container path from **Knowledge resources** in the UI.

Native Linux/WSL runs may index directories under `/home/` or `/mnt/`. Windows drive paths and `\\wsl$\...` paths are translated. A local file can be read through the API only when it remains inside an indexed root.

KeepIndex extracts text and code directly, uses `pdftotext` for PDF, and uses Pandoc for DOCX, ODT, RTF, and EPUB when those tools are available. Unsupported formats keep metadata-only records. An Obsidian root is recognized by its `.obsidian` directory; aliases, tags, and wiki links become searchable metadata.

Useful query operators include:

```text
type:note  ext:pdf  path:projects  tag:research
before:2026-01-01  after:2025-01-01
"exact phrase"  -excluded
```

Credential-like dotfiles, secret/key/token/passphrase material, recovery codes, private keys, and credential extensions are excluded from indexing. Re-index a resource after changing its files so the current metadata and exclusions are applied.

## Private browser memory

Browser-history indexing is off by default. Enable it from **Knowledge resources → Private browser memory**. KeepIndex discovers common Chromium and Firefox profiles on Linux and Windows/WSL, copies the selected history database to a temporary directory, and opens only that copy read-only.

Imported fields are limited to HTTP(S) URL, page title, visit count, typed count, browser name, profile name, and timestamps. KeepIndex does not import page bodies, cookies, passwords, form values, or sessions. URL usernames/passwords, credential-bearing query parameters, and OAuth-style token fragments are removed before anything reaches SQLite. Clearing the private index never touches the browser’s database.

Container users must explicitly mount a selected browser-history database read-only and configure `KEEPINDEX_BROWSER_HISTORY_PATHS`; no profile is exposed to the container automatically.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `KEEPINDEX_DB_PATH` | `server/keepindex.sqlite` | SQLite database path |
| `KEEPINDEX_ALLOWED_ORIGINS` | Empty | Additional comma-separated browser origins allowed to call `/api/*` |
| `KEEPINDEX_BROWSER_HISTORY_PATHS` | Empty | Additional browser-history databases offered for opt-in import |
| `KEEPINDEX_SEARCH_MAX_RETRIES` | `2` | Retries per SearXNG query, clamped to `0..5` |
| `KEEPINDEX_URL` | `http://localhost:5173` | CLI and correctness-runner target |
| `KEEPINDEX_CORPUS_MODEL` | Empty | Explicit model for the live correctness corpus only |
| `KEEPINDEX_INFERENCE_PROVIDER` | `auto` | `auto`, `openai-compatible`, or `ollama` local transport |
| `KEEPINDEX_BIND_ADDRESS` | `127.0.0.1` | Docker host bind for the KeepIndex UI/API |
| `KEEPINDEX_PORT` | `5173` | Docker host port for the KeepIndex UI/API |
| `KEEPINDEX_SEARXNG_BIND_ADDRESS` | `127.0.0.1` | Independent Docker host bind for SearXNG; remains loopback when the UI is shared on a LAN |
| `KEEPINDEX_SEARXNG_PORT` | `8888` | Docker host port for local SearXNG administration |
| `SEARXNG_URL` | `http://127.0.0.1:8888` | Self-hosted web-retrieval endpoint |
| `LLM_URL` | `http://127.0.0.1:8080` | Local inference server root; public endpoints are rejected |
| `LLM_MODEL` | First advertised model | Optional preferred local model |
| `LLM_FALLBACK_MODEL` | Empty | Optional fallback among advertised local models |
| `KEEPINDEX_EMBEDDING_MODEL` | Empty | Optional local OpenAI-compatible embedding model used to rerank lexical knowledge candidates |

KeepIndex reads only the canonical variables in this table. Generic local-provider variables remain generic because they describe user-selected engines rather than the KeepIndex product namespace.

An explicit `KEEPINDEX_DB_PATH` wins. Otherwise KeepIndex opens or creates `server/keepindex.sqlite`; the container sets the canonical path to `/data/keepindex.sqlite` on its named volume.

## State and recovery

Every browser-storage surface uses the KeepIndex namespace:

```text
keepindex-collections
keepindex-session
keepindex-chat-history
keepindex-settings
keepindex-theme
keepindex-journey
keepindex-workspace-recovery
```

Recovery exports use schema `keepindex-state-backup`, the keys above, and `keepindex-backup-*` filenames. Imports accept only that schema, enforce the 10 MB document limit and per-value size limits, require JSON for structured browser state, and validate theme values. Factory reset clears canonical browser state only after every server-side deletion succeeds.

## API examples

KeepIndex binds to `0.0.0.0:5173` inside its runtime so trusted LAN clients can reach it. Replace `<your-host>` with the host address reachable on your private network.

### Search

```bash
curl -s http://<your-host>:5173/api/search \
  -H 'content-type: application/json' \
  -d '{"query":"site:github.com sqlite bm25","focus":"all","target":"all","semantic":true,"count":10}'
```

`target` accepts `all`, `web`, `files`, `vault`, `documents`, or `history`. A private-only target makes no web request.

### Grounded answer stream

```bash
curl -N http://<your-host>:5173/api/ask \
  -H 'content-type: application/json' \
  -d '{"query":"How should I structure my reverse proxy?","focus":"all","target":"all","semantic":true}'
```

### Deep research stream

```bash
curl -N http://<your-host>:5173/api/research \
  -H 'content-type: application/json' \
  -d '{"query":"Compare practical zero-trust patterns for a small homelab","target":"all"}'
```

### Health and knowledge

```bash
curl -s http://<your-host>:5173/api/health
curl -s 'http://<your-host>:5173/api/knowledge/query?q=traefik&limit=8'
```

The API keeps its established response shapes. Health output reports provider, model, database, index, browser-memory, slot, and latency status for local administration and `keepidx status`.

## Security posture

KeepIndex is local-first, not magically safe because it runs locally.

- There is no API authentication. Any host that can directly reach port `5173` can call the API. The Docker quick start publishes it on loopback by default; deliberately change `KEEPINDEX_BIND_ADDRESS` and configure your firewall for trusted LAN use. SearXNG has a separate loopback-only `KEEPINDEX_SEARXNG_BIND_ADDRESS`, so sharing the UI does not also publish port `8888`.
- Browser cross-origin calls are limited to loopback, RFC1918 origins, and explicit `KEEPINDEX_ALLOWED_ORIGINS`. Wildcard CORS is prohibited.
- Request bodies are capped at 3 MB. API responses include `nosniff`, frame denial, and no-store headers.
- Indexed-root containment prevents arbitrary local-file reads.
- Credential-like files are excluded before indexing; browser URLs are stripped before import.
- Source hydration applies only to provenance-confirmed public-web evidence, uses exact host/path allowlists with strict redirect and byte/time budgets, and sends no cookies. Browser-history evidence and private-only targets are never fetched from the public URL.
- Search retries, evidence packs, per-host/per-file diversity, citation validation, query-record durability, actual-model reporting, and post-generation grounding gates remain bounded and fail closed.
- Retrieved text is treated as untrusted evidence, not as system instruction.
- Evidence-derived research gaps remain local whenever private files or browser history influenced the analyzer; only an explicit user query can seed outbound planning.
- Public/cloud inference endpoints and redirects are rejected. KeepIndex contains no analytics, hosted authentication, telemetry export, or third-party tracking.

The public identity at [https://keepindex.ing](https://keepindex.ing) is HSTS-preloaded and therefore HTTPS-only. It identifies the project and documentation; this repository does not claim that the unauthenticated private API is deployed there. Authenticated remote access is future work. Do not expose port `5173` directly to the public internet.

## Verification

Install development dependencies, then run the complete offline/public-release gates:

```bash
bun run brand:check
bun run typecheck
bun test server src
bun run build
bun run test:e2e
git diff --check
```

Do not casually run `bun run test:corpus`. It performs real SearXNG requests against a deliberately budgeted engine pool. The ordinary unit and browser suites use local fixtures and stubs.

## Project references

- [Brand system](docs/BRAND.md)
- [Production brand assets](assets/brand/README.md)
- [Versioned image-generation prompts](assets/brand/prompts/README.md)
- [Retrieval hardening](docs/RETRIEVAL-HARDENING-2026-08-29.md)
- [Portability brief](docs/PORTABILITY-BRIEF.md)
- [Local inference providers](docs/LOCAL-INFERENCE.md)
- [Document intelligence direction](docs/DOCUMENT-INTELLIGENCE.md)
- [Roadmap](docs/ROADMAP.md) — issue prefix `KIX-`
- [Apache-2.0 license](LICENSE)
- [GitHub repository](https://github.com/akougkas/keepindex)
- [Project identity](https://keepindex.ing)
