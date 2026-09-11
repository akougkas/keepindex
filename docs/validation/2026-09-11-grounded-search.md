# ZBook grounded search validation — 2026-09-11

The reported failure was `latest on clio-coder release and features`. The original answer invented an ecosystem architecture, cited no sources, and was rejected by the backend. The browser ignored the rejection and displayed a completed answer with generated takeaways and follow-ups.

## Live environment

KeepIndex and SearXNG run in local Docker containers on ZBook. AI requests in this validation used the existing Lemonade service, including its already-installed Gemma models. No inference request was sent to Blade. Blade and other explicit endpoints remain available in AI connections.

The exact query was checked against the GitHub API release record for `iowarp/clio-coder` and the current local `README.md` and `CHANGELOG.md`. The verified release was **v0.4.7**, published **2026-09-11T01:25:03Z**. The local changelog labels the release **2026-09-10**; that is a distinct document date.

## Measured requests

These are observed end-to-end request durations, not latency guarantees. Model and search-service load, caches, and external engine availability affect timing. Each completed answer was read against its supplied sources; citation coverage alone was not used as the acceptance criterion.

| Query / target | End to end | Citation coverage | Web / local sources | Result |
| --- | ---: | ---: | ---: | --- |
| Clio, all sources | 5.79 s | 100% | 1 / 2 | Supported synthesis |
| Clio, all sources repeat | 5.81 s | 100% | 1 / 2 | Supported synthesis |
| Clio, local checkout only | 3.64 s | 100% | 0 / 2 | Supported synthesis |
| Clio, web only | 15.49 s | 100% | 1 / 0 | Supported synthesis |
| Ollama, web only | 6.87 s | 100% | 1 / 0 | Supported synthesis |
| Nonexistent project | 13.17 s | 0% | 0 / 0 | No evidence; no AI generation |

The installed `Gemma-4-E4B-it-GGUF` model produced the accepted release answers and was selected as the active local model. `Gemma-4-26B-A4B-it-MTP-GGUF` produced one correct 7.1-second result but also ignored source evidence, used malformed citations, or produced a truncated sentence in repeat runs. After the final retrieval and prompt changes, a further MTP local-checkout request also passed in 3.1 seconds, with publication explicitly marked unverified and every claim cited. Those observations do not isolate a model-weight, template, cache, or inference-server defect. KeepIndex must handle such failures safely regardless of their origin.

## Accepted exact-query answer

Clio Coder version 0.4.7 was published on 2026-09-11T01:25:03Z [1]. This release includes:
*   A unified Library for reusable workflows, operator extensions, safer keyboard and draft handling, and a compact welcome header [1, L2].
*   Optional operator extension runtimes with declared namespaced slash commands [1].
*   Bounded session/turn observations and an additive footer status [1].
*   Host-rendered panels and an explicit headless `extensions run` path [1].

Here [1] is the live GitHub release record and [L2] is the current local README's “New in 0.4.7” paragraph. This is an actual model response, not an application-coded answer.

## Browser verification

A Playwright Chromium session submitted the real query through the deployed UI and `/api/ask/stream`. It displayed version 0.4.7, the actual release features, and the citation-coverage label, with no JavaScript errors. The measured browser completion was 8.5 seconds. A subsequent controlled rejected stream removed its fabricated text, displayed the rejection, and issued zero takeaway or related-question requests. The controlled stream was a UI regression check, separate from the real live-model request.

## Additional identity check

A web-only lookup for Marina Stavrakantonaki returned differing same-name professional profiles. The tightened identity filter removed a different-surname artist page that had been admitted through search-engine “Missing:” text. The final model response did not meet citation requirements and was withheld; this is recorded as a safe refusal, not a successful biography synthesis. Resolving identity across such profiles remains a limit.

## Limits

The two large project roots still have capped index snapshots. Bounded current-document reads solve freshness for identified projects without pretending the whole index was refreshed. General local retrieval remains subject to configured indexing limits.

Citation coverage and literal-support checks are deterministic safeguards, not a semantic proof of every paraphrase. When a release synthesis fails, the app can display clearly labelled exact source excerpts; otherwise it withholds the draft. No-evidence responses never become completed AI answers or follow-up material.

External search engines can throttle or suspend individual requests. KeepIndex preserves provider degradation diagnostics and does not treat a nominal health response as proof that every query succeeds.

## Final code and deployment checks

- `bun run test`: 632 tests across 49 files, zero failures.
- `bun run typecheck`: zero TypeScript errors; the production Docker build also runs the typecheck and Vite build.
- `bun run keepidx doctor`: `Result: ready`.
- Final API health: `status: ok`, `healthScore: 100`, `searxng: true`, `llm: true`.
- Both local KeepIndex and SearXNG containers report healthy, with loopback bindings on ports 5173 and 8888.
- The final review also prevents private browser-history URLs from becoming public release-fetch seeds, keeps historical/version-specific questions on their ordinary retrieval path, and preserves the indexer's directory exclusions during bounded current-document reads.
