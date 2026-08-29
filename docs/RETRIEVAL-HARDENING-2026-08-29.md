# KeepIndex retrieval hardening — 2026-08-29

Evidence-driven hardening of KeepIndex's federated local/private search before its
first public release. Every defect below was reproduced with synthetic data by an
executable probe before it was fixed, and every fix landed behind a regression test
that failed first. No private vault, browser profile, or source database is part of
this report.

**Live SearXNG requests spent: 0.** The whole pass ran offline against synthetic
fixtures, the `__test__` seams, and scripted `globalThis.fetch`. The live
evaluation corpus is designed and costed but deliberately deferred, so its
numbers get measured against already-fixed code.

## Method

1. Map the contract at each boundary: federation, ranking/fusion, local BM25,
   semantic expansion, browser history, document extraction, grounding, research
   degradation, provider failure handling, and persistence.
2. Reproduce each suspected defect with an isolated synthetic fixture or a stubbed
   transport. A test must assert the safe behavior and fail on the defective path.
3. Apply the smallest correction that preserves API shapes and the surrounding
   retrieval/security invariants.
4. Run the complete offline unit, build, browser, artifact, and container gates.
   No test was deleted, weakened, skipped, or redirected to a live service.

## What was wrong, and what changed

### Critical

**Title Case queries destroyed local recall.** `shortEntityQuery` classified any
2–4 token query whose tokens were all capitalized as a person lookup, which turned
on `entityCoverageRequired`. `hasDescriptiveEntityContext` then demanded a
person-role word ("professor", "engineer", "founded") within 220 characters of the
phrase, or a bio/CV-shaped file path. An ordinary technical note satisfies neither.

In the fixed synthetic corpus, `Context Engineering Guide` and
`context engineering guide` now return the same ranked notes. The failing probe had
returned zero for the Title Case form despite an exact note title match. Title Case
is how people naturally search for a note by its title.

The capitalization branch had no test coverage. The only entity test in the suite
uses the lowercase `who is …` prefix, which is a separate branch. Removed the
capitalization branch; explicit person intent still gates the hard filter.
`server/index.ts` `shortEntityQuery`.

**The API was readable by any website.** `cors({ origin: '*' })` applied to
`/api/*` on a server bound to `0.0.0.0:5173` with no authentication, serving the
vault, the browser-history index, and the search log. Any page open in the same
browser could `fetch('http://127.0.0.1:5173/api/knowledge/search?q=…')` and read
vault chunks verbatim, enumerate browser profiles, or `DELETE` the history index.

Now loopback and RFC1918 origins only, with `KEEPINDEX_ALLOWED_ORIGINS` as a
comma-separated override. Every documented use is unaffected: shell clients send no
`Origin` header at all, and a browser opening the UI on any interface is
same-origin. `server/index.ts` `allowedApiOrigin`.

**Credential files were being indexed in full.** `SENSITIVE_FILE_PATTERN` bounded
its keywords on `[._-]` but not on whitespace, and its keyword list had no concept
of an API key or of recovery codes. It therefore skipped `my-token.md` while
indexing `pypi token zulipchat-mcp.md`, `openai_api_key.md`, `api-key.txt`,
`fredaccount.stlouisfed apikey.md`, and `PyPI-Recovery-Codes-*.txt`.

Synthetic files matching those shapes demonstrated that their inert marker content
would have been searchable and eligible for an evidence pack. No real credential
file was opened to prove the defect.

The pattern now bounds on whitespace as well as punctuation and covers
`api key` / `api_key` / `apikey`, `access token`, `passphrase`, and
`recovery`/`backup codes`. Fourteen false-positive guards keep `tokenizer.md`,
`keynote-outline.md`, `secretary-notes.md`, `passwordless-ssh-guide.md` and
similar ordinary notes searchable. The first public KeepIndex index therefore
starts with the widened filter already in force.

### High

**Browser-history relevance was sign-inverted.** FTS5 `bm25()` is negative and
more negative means a better match. The scorer took `Math.abs`, then computed
`1 / (1 + rank)`, which decreases as match quality improves, then sorted
descending. The verbatim-title match scored 0.4579 and finished last; a row
matching one incidental token scored 1.2890 and finished first. Because the final
slice cuts from the bottom, strong matches were usually dropped rather than merely
demoted: with 60 noise rows sharing one token, zero of three strong matches
survived the top five. `server/database.ts` `searchBrowserHistory`.

**History search flooded on common short words.** The FTS MATCH string kept every
term of length ≥ 2 with no stopword filter and OR-joined them as bare prefix terms,
so `or*` prefix-matched every `.org` host. Adding one stopword to a precise query
displaced every real result. Now filtered through the repo's existing tokenizer
policy, with a fallback so an all-stopword query still answers.

**Credential-bearing URLs were imported verbatim.** `safeUrl` checked only the
protocol and returned `url.toString()`, preserving username, password, query and
fragment. OAuth implicit-flow fragments, magic-link `?token=` URLs and
`https://user:pass@host/` were copied into the local index, became searchable, and
could reach an LLM prompt. Now strips userinfo, credential-bearing query
parameters, and credential-bearing fragments, mirroring the existing helper in
`source-hydration.ts`. Credential-name matching normalizes snake case, kebab case,
camel case, and acronym transitions, so `access_token`, `accessToken`,
`clientSecret`, `sessionId`, collapsed `ACCESSTOKEN`, and `authCode` receive the
same treatment. Encoded and double-encoded names and fragment delimiters are
decoded within a fixed budget before classification; opaque encodings that
exceed that budget fail closed. SAML assertions, CAS tickets, Firebase action
codes, and credentials nested inside encoded redirect URLs are removed as well.
Generic words such as
`code`, `key`, and `session` require an exact or high-confidence credential
compound; benign parameters including `monkey`, `tokenizer`, `countryCode`,
`sourceCode`, `encryptionKey`, and `sessionView` remain intact. Ordinary query
strings survive, since for a history entry they are often what identifies the
page.

**Research evidence could become an outbound search instruction.** The
intermediate analyzer received web and private local evidence, then its free-form
`gaps` array was sent back through SearXNG. A hostile note or page could therefore
ask the local model to copy private material into a follow-up web query. The
analyzer now receives an explicitly delimited, untrusted source pack, and its
instructions forbid following source directives. More importantly, the runtime
enforces an egress boundary independent of prompt compliance: if the analyzer saw
local or browser-history evidence, its proposed gaps may search local indexes but
cannot leave through web search. The pre-search planner receives only the explicit
user query, never journey or handoff memory. Public-only research keeps adaptive
web gap filling. Browser-history provenance remains sticky when public and private
records collapse by canonical URL or same-host title, regardless of arrival order.
Only provenance-confirmed public-web evidence is eligible for allowlisted source
hydration; history-tainted evidence and private-only targets never cause a public
page fetch.

**Ungrounded answers shipped as successes.** `/api/ask` refused only *before*
generation, when zero sources were retrieved. After generation there was no gate at
all: an answer citing `[7]` against a three-source pack, or citing nothing, still
streamed deltas, emitted an ordinary `done` frame, and persisted
`outcome: 'succeeded'`. Ask and Research now share one terminal policy after
bounded repair: every identifier must resolve into the exact prompt pack, at least
one citation must resolve, and claim-level coverage must reach 80%. A failing Ask
records `outcome: 'no_evidence'` and terminates with `done { grounded: false }`; a
failing Research report records the same auditable outcome, emits an error, and
never emits a success terminal event.

**Quoted phrases were silently dropped on the federated path.**
`parseLocalSearchQuery` seeds extensions, tags and excluded terms from its
inherited options but initialized `phrases` to an empty array. The federated path
parses once in `runFederatedSearch` and again inside `searchKnowledge`, so the
constraint vanished on exactly that route. The identical query
`"model context protocol" "zzzz impossible phrase zzzz"` returned 0 through
`/api/knowledge/query` and 5 through `/api/search`.

**Private targets returned public URLs.** `runFederatedSearch` always ranked
`[...webOutcome, ...deriveAuthoritativeSourceSeeds(query)]`. Because
`skippedWebOutcome()` returns an empty *array*, the `Array.isArray` guard passed
even with web disabled, and hardcoded first-party URLs were injected into `vault`,
`files`, `documents` and `history` searches. Measured: `target=vault` returned a
`trychroma.com` URL. `/api/ask` and `/api/research` already guarded the same call;
only `/api/search` did not.

**Citation coverage was inflated four ways.** An answer with nothing gradeable
reported 100% if any one identifier resolved. A seven-word floor exempted short
factual assertions, which is the register compact models write in. A whole Markdown
table collapsed into one claim segment, so one cited row certified every row beside
it. And the sentence splitter refused to break when a citation opened the next
sentence, fusing two claims under one citation. All four now grade honestly; the
floor is five content words excluding citation tokens, table rows are graded
independently, and header and separator rows stay out of the denominator.

The citation-repair loop is now skipped when there are zero gradeable claims, since
it has nothing to repair there and only spends an LLM call.

**Version queries returned nothing.** `tokenizeQuery` collapses `18.3.1` into the
single token `18_3_1`, but the index tokenizer split on the same punctuation and
emitted `18`. The query token therefore existed in no document, took the maximum
IDF, inflated the total query weight, and pushed every candidate under the coverage
floor — zero local results for `react 18.3.1 hooks` even with a note containing that
exact string. Both tokenizers now apply the same version normalization.

**Provider failure was indistinguishable from relevance failure** in five places.
A total outage on `target=all` recorded `outcome: 'succeeded'` because the check
required `target === 'web'` exactly. A partly refused discovery fan-out set
`degraded: false` because one surviving branch still returns an array, and the
`"1/3 discovery queries failed"` string never left its `WeakMap`. A CAPTCHA-
suspended engine fleet answers HTTP 200 with valid JSON, zero results, and every
engine in `unresponsive_engines`; it classified as `no-results`, a relevance
verdict. `/api/ask` recorded a blocked provider as `no_evidence`. And the retrieval
verdict was computed and persisted but never streamed, so an SSE client could not
attribute an empty answer to the provider.

All five now report honestly, and `/api/ask` emits a new `retrieval` SSE event
carrying `{ degraded, retrievalDiagnostics }`.

### Medium

Zero-token queries — non-Latin scripts, punctuation-only input — took a degenerate
branch and returned the most recently modified files stamped `queryCoverage: 1`,
which reads as a relevance ranking and was admitted downstream as evidence. They now
return empty unless the query carried an actual structural filter, so `tag:mcp`
still browses.

`before:` and `after:` defaulted an unknown modification time to 0, so `before:`
silently matched every undated chunk while `after:` rejected them all. Both now
reject unknown dates.

The quoted-phrase haystack was built from filename, path and content only, so a
note was findable by its Obsidian alias as loose terms but never as the exact
phrase the alias is. Aliases and tags now feed the phrase haystack, matching how
they already feed the BM25 term frequencies.

`fuseFederatedSearch` returned one result for `limit: 0`, because the push preceded
the length check. The host and per-file diversity caps were unenforced: the backfill
pass drained held-back rows with no cap re-check, so twelve results from one host
all shipped despite a cap of three. Backfill now relaxes the cap progressively
instead of abandoning it.

`buildSingleRetrievalDiagnostics` was fed `counts.web + counts.history` as the
selected web count. Those two buckets overlap by design — a live page the user has
also visited is one card carrying a private corroboration signal — so the sum
double-counted. Fixed at the consumer; `counts` semantics are unchanged, as the
existing test asserts them.

Fusion is reciprocal-rank fusion and reads only rank, never the provider's own
relevance score. That is correct for RRF, but it meant a vault chunk scoring 0.01
and one scoring 9999 landed in the identical slot. Rather than corrupt RRF into a
score-weighted sum, a relevance admission floor now runs *before* fusion, mirroring
what the ask path already does. See the caveat under "Known limitations".

## New knob

`KEEPINDEX_SEARCH_MAX_RETRIES` (default `2`, unchanged) bounds retries per SearXNG
query. Setting it to `0` makes exactly one attempt, which the evaluation harness
needs in order to count live requests exactly.

## Known limitations

**Local relevance is normalized relative to the batch.** `normalizeLocalEvidenceScores`
maps each call's scores onto 0..1, so the best chunk of an entirely irrelevant vault
is always 1.0. The new admission floor stops the pathological case but cannot fix
the underlying scale problem. Calibrating an absolute local floor needs the live
candidate distribution, which is what the deferred evaluation pass measures.

**Searchable metadata depends on deterministic extraction.** Obsidian aliases,
tags, wiki links, source kind, extension, and modification time are persisted when
the extractor can establish them. Unsupported binary formats intentionally remain
metadata-only, and a file without a reliable modification time is excluded from
both `before:` and `after:` filters. Synthetic vault and browser-history fixtures
verify metadata round trips, credential-file exclusion, and URL stripping without
opening an owner profile or indexed collection.

## Verification

```text
bun run brand:check     9 deterministic vector masters
bun run typecheck       passed
bun test server src     586 passed, 0 failed, 46 files
bun run build           2,552 modules transformed
bun run test:e2e        12 Chromium specs passed
```

All database probes used disposable KeepIndex test state. No source or running
installation database was opened, copied, migrated, renamed, or modified, and the
live correctness corpus was not run.
