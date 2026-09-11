<p align="center">
  <img src="assets/brand/keepindex-lockup.svg" width="900" alt="KeepIndex — Search your world. Keep it yours." />
</p>

# KeepIndex

**Private search on your computer. Your choice of AI.**

KeepIndex brings your selected folders, Obsidian vaults, documents, and opt-in browser history together with web search. Its application, index, and search engine container run on the computer you use. AI uses your selected local runtime or remote endpoint. Open the local app, find your sources, and inspect the citations behind an answer.

[keepindex.ing](https://keepindex.ing) is the product website and installation guide. It does not host your search workspace. There is no KeepIndex account, hosted index, cloud AI fallback, device pairing, or cross-device synchronization. Federation is deferred.

## Start on your computer

Install Docker Desktop or Docker Engine with Compose. For AI answers, connect a local model runtime or explicitly select a remote AI endpoint; Docker does not automatically download a model. See [local inference](docs/LOCAL-INFERENCE.md) for local runtimes and remote gateways.

```bash
git clone https://github.com/akougkas/keepindex.git
cd keepindex
cp .env.example .env
# Set LLM_URL to your preferred AI endpoint; choose a model that fits your RAM.
./start.sh
```

Open **[http://localhost:5173](http://localhost:5173)** on this computer. The launcher builds the app, starts its SearXNG container, and creates a persistent SQLite volume. Ctrl+C stops the foreground stack. To run in the background:

```bash
docker compose up -d --build
docker compose ps
```

Both published ports are fixed to loopback: KeepIndex `5173`, SearXNG `8888`. Changing `KEEPINDEX_BIND_ADDRESS` no longer exposes the app. The API also rejects remote Host names and foreign browser origins. Native development binds to `127.0.0.1`.

Search can run without an AI model. Answer and research modes report unavailable inference if the local runtime is stopped. Nothing is rerouted to another machine.

## Select your AI

Open **Settings → AI connections**. Choose Lemonade, LM Studio, Ollama, llama.cpp,
Blade AI Gateway, or add another compatible endpoint. **Check endpoints** probes
the configured public model APIs. Then choose a model from that endpoint's catalog.

Local AI is recommended by default. Selecting remote AI sends prompts and retrieved
excerpts to that endpoint; the original files and local index remain on this computer.
The selected endpoint and its scope are shown beside the query box. There is no
automatic fallback between connections. See [AI connections](docs/LOCAL-INFERENCE.md)
for URLs, credentials, persistence, and Docker networking.

## Give it a folder

A container cannot read your laptop's folders until you grant access. Create `compose.override.yml` with a selected folder mounted read-only:

```yaml
services:
  keepindex:
    volumes:
      - type: bind
        source: /absolute/path/to/your/notes
        target: /home/keepindex/knowledge
        read_only: true
```

Restart with `docker compose up -d`, open **Knowledge resources**, and add `/home/keepindex/knowledge`. That is the container path, not the original host path. Add more explicit mounts for other folders. Do not mount your entire home directory just to reach one vault.

On Windows with WSL, the source might be `/mnt/c/Users/you/Documents/notes`. On macOS it might be `/Users/you/Documents/notes`; grant Docker Desktop file sharing for that folder if prompted. A native Linux/WSL install can use accessible paths under `/home` and `/mnt` directly.

KeepIndex reads text and code, PDF through Poppler, and DOCX/ODT/RTF/EPUB through Pandoc. The production image includes these extractors. Unsupported files may have metadata-only entries. Obsidian aliases, tags, and wiki links become searchable metadata. Re-index after changing files.

Secret-like files, hidden folders, credentials, and key material are excluded by default. These exclusions are a useful filter, not a guarantee that arbitrary documents contain no secrets. Select your folders accordingly. Removing an index does not delete original files.

## Choose browser profiles explicitly

A website cannot read browser history just because you open it. KeepIndex imports readable history databases on this computer only after you choose profiles and press **Import selected profiles** in Knowledge resources. It imports URL, title, visit count, and timestamp metadata; it does not import passwords or cookies.

For Docker, mount a selected profile directory read-only and configure the history file path. Mounting the directory also makes SQLite sidecar files available when present:

```yaml
services:
  keepindex:
    environment:
      KEEPINDEX_BROWSER_HISTORY_PATHS: /home/keepindex/browser/chrome/History
    volumes:
      - type: bind
        source: /absolute/path/to/your/Chrome/User Data/Default
        target: /home/keepindex/browser/chrome
        read_only: true
```

Firefox uses `places.sqlite`. Separate multiple configured paths with semicolons. Close the browser and retry if its live database cannot be copied consistently. Review discovered profiles in the UI; none are selected automatically. A mounted profile directory may contain other sensitive browser files even though the importer reads only history, so grant only the profiles you intend to use. Browser history from your phone is not available to this installation.

## Search locally, or include the web

| Source | What happens | Where the data goes |
| --- | --- | --- |
| Selected files and vaults | Extract, chunk, index, and rank locally | This computer's SQLite index and local application |
| Selected browser history | Import and search URL/title/visit metadata | This computer's SQLite index |
| AI answers and embeddings | Use your selected endpoint | Local runtime by default; remote endpoints receive prompts and retrieved excerpts when selected |
| Web search | The local SearXNG container queries public engines | Search terms reach external engines; opened/fetched websites see normal requests |
| Exports | You choose to download a backup | The location you choose; the export contains private data |

Choose **Files**, **Vaults**, **Docs**, or **History** to retrieve that local source category without web discovery. **All** and **Web** send search terms to public search engines. Do not put private details into a query that includes the web. Running SearXNG locally does not make external web searches offline or invisible to search engines.

Useful operators: `type:note`, `ext:pdf`, `path:projects`, `tag:research`, `before:2026-01-01`, `"exact phrase"`, and `-excluded`.

Search combines ranked results from available sources. Answer and research modes send a bounded evidence pack to the selected AI endpoint. Citation checks validate identifiers, coverage, and lexical support during repair; they cannot prove every generated claim true. Inspect the cited sources for important decisions.

## One installation, one device

```text
YOUR COMPUTER
  Browser / installed PWA
             │ loopback
  KeepIndex UI + API ─── SQLite index, settings, evidence records
        │                         │
        │                 selected local folders / history
        ├── local AI connection (local runtime or selected remote endpoint)
        └── local SearXNG container ─── public search engines / websites
```

A phone opening `keepindex.ing` sees the product site. It does not connect to this computer. An independent installation on another computer has its own sources and index. Remote access, NAS discovery, pairing, and federation are outside this release's supported deployment model. An OS-mounted network share is technically readable like a folder, but indexing it copies extracted content into this computer's index; it does not provide source-resident federation.

The local API has no user authentication. Loopback and browser-origin checks are the boundary for a personal installation, not isolation from other OS users or malicious software already on the computer. Keep the OS account protected. SQLite and browser storage are not encrypted by KeepIndex; use full-disk encryption and protected backups when needed. Do not publish the app behind a tunnel or reverse proxy.

## Operate and develop

```bash
docker compose logs --tail=80 keepindex
docker compose stop                 # retain containers and data
docker compose down                 # remove containers; retain named volumes
# docker compose down -v deletes the local index and app state; original files remain.
```

For native development, install Bun, Docker, and optional document extractors:

```bash
bun install --frozen-lockfile
# .env.local overrides .env in Bun: use native loopback provider URLs here.
# LLM_URL=http://127.0.0.1:8080
# SEARXNG_URL=http://127.0.0.1:8888
docker compose up -d searxng
bun run dev
```

The native CLI supports `bun run keepidx doctor`, `status`, `status --json`, `open`, and `start --detach`. It checks the environment in which it runs; a host CLI cannot inspect Docker's internal database mount or resolve every Docker-only hostname. For the exact running stack, inspect `docker compose ps` and `curl -fsS http://localhost:5173/api/health`.

The [ZBook model comparison](docs/benchmarks/2026-09-11/README.md) records exact
Hugging Face weights, Lemonade configurations, cited-answer and document-selection
results, latency measurements, and known failures. It includes a reproducible
synthetic corpus; its model timings are separate from full-product retrieval.

```bash
bun run test
bun run typecheck
bun run build
```

All public application API routes live under the same local origin. Example:

```bash
curl -N http://localhost:5173/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"query":"What do my notes say about indexing?","target":"vault"}'
```

Settings contains local state export, restore, and reset controls. Exports can contain private content. Original source files are never removed by a KeepIndex reset. The separate [website deployment guide](website/keepindexing/deploy/README.md) covers static product hosting only.

Licensed under Apache-2.0. See [LICENSE](LICENSE).
