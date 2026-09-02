# Live query performance baseline

Measured on 2026-09-02 against the local Docker deployment with ten sequential
`/api/ask` requests. Every request used `target=all`, `focus=all`, and
`semantic=true`, matching the current UI defaults. The raw machine-local report
is written by `bun run profile:live` and is intentionally not committed because
it contains complete query records and source packs.

## Aggregate results

| Metric | Mean | p50 | p95 / max |
| --- | ---: | ---: | ---: |
| End to end | 80.6 s | 60.6 s | 162.1 s |
| First server event | 12.3 s | 10.6 s | 17.9 s |
| First visible answer token | 44.6 s | 39.7 s | 87.1 s |
| Semantic-expansion call | 7.5 s | 7.6 s | 8.7 s |
| Local retrieval | 3.3 s | 2.1 s | 10.0 s |
| Web retrieval | 6.8 s | 5.0 s | 13.0 s |
| Main inference stream | 37.8 s | 34.7 s | 55.5 s |
| Citation repair, when invoked | 56.7 s | 55.0 s | 67.4 s |

Outcome distribution: four succeeded, five failed the grounding gate with
`no_evidence`, and one was interrupted after reaching the model output limit.

## Optimization results

The same ten-query corpus was rerun sequentially after each change set. Raw
reports were saved outside the repository at `/tmp/keepindex-profile-stage1.json`,
`/tmp/keepindex-profile-stage2.json`, and `/tmp/keepindex-profile-stage3.json`.

| Run | Mean end to end | Mean first event | Mean first visible token | Outcomes (success / no evidence / interrupted) |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 80.6 s | 12.3 s | 44.6 s | 4 / 5 / 1 |
| Stage 1: bounded generation and deterministic Ask cleanup | 47.9 s | 7.0 s | 37.3 s | 4 / 2 / 4 |
| Stage 2: immediate SSE and embedding reranking | 44.6 s | 2.2 s | 38.8 s | 4 / 4 / 2 |
| Stage 3: flushed SSE, bounded query variants, 12-source pack | 40.8 s | 0.007 s | 34.1 s | 5 / 3 / 2 |

Stage 2 replaced model-driven semantic rewriting with hybrid reranking through
the configured private embedding endpoint and
`text-embedding-nomic-embed-text-v2`. Embedding reranking averaged 371 ms in
Stage 2 and 428 ms in Stage 3. Missing or invalid vectors fall back to lexical
ranking. Stage 3 reduced the ordinary Ask evidence pack from 18 to 12 sources,
added at most one concurrent keyword-form web query for long conversational
questions, and yielded the Bun event loop after `request_accepted`; the first
real UI event consequently fell to 7 ms mean and 31 ms maximum.

The current dominant cost is generation: `inference_stream` averaged 35.4 s in
Stage 3, compared with 2.4 s for local retrieval, 5.2 s for web retrieval, and
38 ms for ranking/fusion. The Stage 3 quality distribution improved over the
baseline but two responses still exhausted the restored generation budget, so
latency should not be reduced by lowering that budget again.

## Measured findings

1. The server does not open the SSE response until retrieval, ranking,
   hydration, and prompt assembly finish. The UI therefore receives no genuine
   progress signal for 9.6–17.9 seconds.
2. Semantic expansion spent 5.9–8.7 seconds on every request, but returned usable
   alternate queries for only two of ten requests. Eight requests paid for an
   extra model call and still used keyword-only retrieval.
3. Web retrieval and semantic expansion overlap, but local retrieval begins only
   after expansion. Local ranking then scans the 160,000-chunk in-memory corpus
   synchronously, blocking the JavaScript event loop for as much as 10 seconds.
4. The model reported a mean first-token latency of 11.4 seconds, while visible
   answer content appeared a mean 32.4 seconds after the first server event.
   Reasoning-only output and fallback generation need separate accounting; phase
   tracing now records first reasoning, first content, and fallback calls.
5. Citation repair ran on five requests, cost 50.1–67.4 seconds, improved none of
   them, and all five still ended as `no_evidence`.
6. The current 1,800-token answer budget produced long generations. Two requests
   reached the output limit; one required an uninstrumented fallback in this
   baseline and one ended interrupted.
7. Every web attempt was partial during the run. Yep repeatedly returned HTTP
   403 and Mwmbl repeatedly timed out. The final observed engine coverage was
   50% (Bing and Seznam live).
8. Several searches had raw web candidates but admitted no web evidence after
   relevance ranking. The answer then became local-only despite `target=all`.

## Optimization targets

The first optimization cycle should target independently measurable budgets:

- Open SSE immediately and emit query-planning, web, local, ranking, hydration,
  generation, and grounding progress events.
- Avoid speculative semantic expansion for entity/exact-name queries; run it
  only as a fallback when keyword retrieval is weak, and never block web or the
  first local pass on it.
- Move local candidate generation to SQLite FTS (or a worker) so the main event
  loop does not scan 160,000 chunks per branch.
- Bound answer length based on query intent and record reasoning/content token
  timing separately.
- Replace repeated full-model citation repair with a cheap deterministic pass
  and at most one model repair when it has a measurable chance to cross 80%.
- Tighten web relevance and canonical deduplication, and measure raw, ranked,
  admitted, and independent-host counts separately.

## Reproduction

```bash
bun run profile:live
```

Override `KEEPINDEX_URL`, `KEEPINDEX_PROFILE_OUTPUT`, or
`KEEPINDEX_PROFILE_QUERIES` (a JSON array containing at least ten strings) when
needed. Runs are sequential by design so the baseline represents one interactive
user rather than a concurrency stress test.
