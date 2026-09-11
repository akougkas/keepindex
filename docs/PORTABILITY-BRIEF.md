# Single-computer product boundary

KeepIndex is a personal application installed on the computer where its sources live. The UI, API, SQLite index, and SearXNG instance stay on that computer. AI can run locally or at an explicitly selected remote endpoint. Docker containers and host processes are two ways to run components within that boundary.

The public website at https://keepindex.ing distributes the product and documentation. It has no private API, index, local-device bridge, or model credentials. Blade hosts this static site only in KeepIndex's deployment topology.

## Installation contract

- Docker publishes the application and SearXNG only on loopback. The native application binds to loopback too.
- No home directory, vault, browser profile, or network share is mounted by default. Users select folder mounts and then register their container paths.
- Users choose browser profiles before importing their history. The importer reads metadata from local copies and does not modify original databases.
- SearXNG stays on this computer. AI connections may use local, LAN, Tailscale, or public compatible endpoints. Connection scope is visible; redirects and credentials embedded in URLs are refused.
- The API checks its local Host, rejects foreign browser origins before executing requests, and serves no-store responses. It has no multi-user authentication.
- An unavailable runtime causes an unavailable AI result. There is no remote inference fallback.
- Web-enabled queries leave the computer through public search engines. Files, Vaults, Docs, and History each retrieve their local source category without web discovery.
- Local storage contains extracted private content and is not encrypted by KeepIndex. OS account controls, disk encryption, and backup handling remain relevant.

## Device behavior

ZBook uses its own installation, selected files, local history, and local models. A phone opening the public domain sees the product website. A second desktop installation has its own independent index. A sleeping or powered-off computer does not offer a remote search service.

Federation, pairing, remote viewing, source agents, and network-wide discovery are deferred. There is no active federation design or implementation in this release. OS-mounted remote folders are not source-resident indexing: extracting them would copy content into this computer's index.

## Verification

Endpoint-policy tests cover inference URL validation, endpoint/credential isolation, remote search-provider rejection, browser write/preflight rejection, DNS rebinding, and permitted loopback/Compose origins. Existing retrieval, citation, history, state, and CLI suites remain required. Live checks verify the actual local provider and mounts; static website deployment is verified separately from application health.
