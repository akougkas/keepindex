# KeepIndex roadmap — verified remaining work

Every item below was rechecked against the hardened implementation for the first
public KeepIndex release after the 2026-08-29 retrieval pass. Speculative,
already-fixed, and unreachable items were removed. Each remaining item names the
code path, user-visible consequence, and a bounded approach.

`KIX-` is the canonical KeepIndex issue prefix for this roadmap and future public
tracking. Allocate identifiers sequentially and never recycle one.

`LIVE` marks work that needs the deferred live evaluation pass to size or decide.
See `docs/RETRIEVAL-HARDENING-2026-08-29.md` for what was already fixed.

## Delivered in v1.1.0

The following verified hardening milestones have been delivered, tested, and validated on the `dev/v1.1.0` release line:

- **KIX-01 · Absolute Local Evidence Admission**: Prevents irrelevant vault chunk admission via combined absolute BM25 score and query coverage signals.
- **KIX-02 · Lexical Support Gating for Citation Repair**: Verifies claim-to-source lexical support before accepting newly introduced citations in post-generation repair.
- **KIX-03 · Compact File Paths & Metadata-Only Exclusions**: Excludes metadata-only stubs from citable evidence packs and strips home directories from file paths.
- **KIX-04 & KIX-17 · Browser-History Recency & Ledger Scoping**: Neutralized synthetic recency bonus for history items and restricted persisted query ledger to actually selected sources.
- **KIX-06 & KIX-07 · Weighted Stream Allocation & Diversity Backfill**: Configurable fusion weights (`webWeight`, `localWeight`) with two-tier diversity preservation.
- **KIX-08 · Token-Bounded Exclusion & Path-Isolated Phrases**: Replaced substring exclusion with whole-token matching and isolated phrase matching from directory paths.
- **KIX-09 · Parse-Free Query Expansion**: Split `searchKnowledge` and `searchKnowledgeCore` so internal subqueries and aspect expansions bypass operator re-parsing.
- **KIX-10, KIX-11 & KIX-12 · Query Pinning & Expansion Sizing**: Pinned original query in multi-aspect ranking and decoupled semantic pack sizing from discovery query length.
- **KIX-13 · Accurate Skipped Web Diagnostics**: Sets `web.state: 'skipped'` when `target=vault` instead of reporting spurious timeout or provider failure.
- **KIX-14 · Request-Scoped Model Fallback & Deadline Timeouts**: Bounded LLM retries to request deadline without permanently mutating global default model state.
- **KIX-20 · Truncated Completion Grading**: Retains `truncated: true` flag and persists grounding diagnostics on length finish.
- **KIX-21 · Discriminator Statuses for Follow-ups & Takeaways**: Surfaces `{ status: 'ok' | 'unavailable' | 'skipped' }` telemetry for downstream panels.
- **KIX-22 · Citation Coordinate & Namespace Hardening**: Formatted local coordinates as `(lines 118-140)` and propagated leading `L` namespace across grouped brackets (`[L1, 2]` -> `['L1', 'L2']`).
- **KIX-23 · Directory & Store Exclusions (partial)**: Default exclusions for `repomix-output`, `__NUKED`, `experiment-results`, `lancedb`, `chroma`, etc., plus per-resource literal substring exclusions through the API. Glob syntax and a knowledge-panel editor remain open.
- **Modern Windows WSL UNC Paths**: Full support for `\\wsl.localhost\...` alongside `\\wsl$\...` in path resolver.
- **Frontend Ergonomics & Shortcuts**: Added quick mode switcher (`Alt+1/2/3/4`), target cycle (`Alt+T`), quick copy (`Cmd+Alt+C`), shortcut palette (`?`), vault count pill in answer metadata, and Command Palette shortcuts.
- **Stress-Tested Against Real Corpora**: Tested against real 15,800+ chunk Obsidian vault (`vaultex`) and multi-directory code garden (`knowledge_garden`).

## Planned Future Work

### KIX-01 · Local evidence admission is batch-relative, so an irrelevant vault always contributes a cited chunk
**critical · medium effort · retrieval quality**

`normalizeLocalEvidenceScores` divides every chunk by the batch maximum, so the
rank-1 local chunk always scores exactly 1.0 no matter how poor the match. On
`/api/ask` that clears `minLocalNormalizedScore` 0.3 unconditionally. On
`/api/search`, `localToFederated` hands `fuseFederatedSearch` the same 1.0 and the
new 0.05 admission floor is a no-op against it. Web, by contrast, is gated on an
absolute score. Ask a question your vault knows nothing about and the answer still
cites a vault note. Research amplifies it: normalization runs per sub-question
branch, so every branch donates its own 1.0 chunk.

`server/index.ts` `normalizeLocalEvidenceScores`, `localToFederated`;
`server/retrieval.ts` `minLocalNormalizedScore`; `server/federated-search.ts`
`MIN_RELEVANCE_SCORE`.

Carry an absolute signal alongside the relative one. `weightedCoverage` is already
computed during scoring but dropped by `localToFederated`; propagate
`queryCoverage`/`queryTermCount` into `FederatedSearchResult` and apply
`coverageAdmissionFloor` inside `fuseFederatedSearch`. Add an absolute
BM25-per-matched-term floor calibrated from the index statistics rather than the
batch. Keep the relative score for ordering only.

### KIX-02 · Citation repair can invent support, and the grounding score rises for the miscite
**critical · medium effort · correctness**

In `source-aware` mode the citation-preservation guard is short-circuited, so the
citation multiset may change freely. Every remaining accept guard is structural:
length ratio, heading count, no out-of-range identifiers, strictly increasing
coverage. Nothing checks that a newly added identifier's excerpt actually supports
the sentence, while the prompt explicitly tells the model to add citations until
coverage reaches 80%. The accept criterion therefore rewards the exact failure
mode: an honestly uncited claim becomes a confidently miscited one, the number goes
up, and the new post-generation gate then passes it because the identifiers resolve.

`server/index.ts` `repairCitationCoverage` guards and the repair loop.

Gate acceptance on evidence rather than structure. For each identifier the pass
added or repeated, require lexical overlap between the claim segment and that
source's excerpt, reusing the existing tokenizer and covering-span helper. Cap the
number of newly introduced identifiers per pass, and record the added-identifier
count in the persisted grounding record so a regression is visible.

### KIX-03 · Failed-extraction stubs are citable evidence and leak absolute home paths
**high · small effort · correctness, privacy**

A failed PDF or DOCX extraction produces a six-line stub whose body contains
`Name: <file>` and `Path: /home/<user>/…`. Nothing filters `metadataOnly` anywhere
on the evidence path. BM25 length normalization favours the short stub and the
anti-placeholder phrase bonus fires for it, so it can outrank real content on a
filename query. The model then cites a source containing no document text, and the
OS username reaches the prompt.

`server/document-extraction.ts` metadata fallback; `server/index.ts` scoring push,
`localToFederated`, and the prompt packer.

Exclude `metadataOnly` chunks from citable evidence while keeping them discoverable
through the structural-filter branch, where they are presented as file hits rather
than evidence. Replace the absolute `Path:` line with `compactFilePath` output.

### KIX-04 · Browser-history rows are ranked and cited as web sources with a content-free snippet
**high · medium effort · correctness**

History rows are appended to `webCandidates` and run through `rankWebResults` with
`rank = index + 1`, the same prior scale as a SearXNG rank, and
`publishedDate = lastVisitedAt`, which hands them the full recency term most real
web results score zero on. Their snippet is `Privately imported from <browser> ·
visited N times` with no page content, and hydration cannot enrich it because
history hosts are not allowlisted. The model cites `[n]` pointing at a source with
nothing to read, and the row is persisted into `sourcePack.web`.

`server/index.ts` `fetchBrowserHistoryResults`, the `webCandidates` concatenation,
and the web prompt section.

Either give history its own prompt section and citation namespace, or require a
hydrated body before a history row is admitted as citable evidence. At minimum,
zero the recency term and the rank prior for `sourceType: 'history'` inside
`rankWebResults` so it competes on lexical relevance alone.

### KIX-17 · Every retrieved history row is persisted into the durable query log
**medium · small effort · privacy**

`sourcePack.web` is written as the full concatenation of web results and every
history row the FTS query returned, up to 120 rows, while `sourcePack.local` is
correctly narrowed to what was actually selected. Rows that never reached the
user's screen are copied into a second durable store and are readable from
`/api/queries/:requestId`.

`server/index.ts` `handleFederatedSearch`.

Narrow `publicWeb` the same way `selectedLocal` is narrowed: build the identifier
set from the fused results and filter both arrays through it before assigning
`sourcePack`.

## Retrieval quality

### KIX-06 · Ask and research fusion force a 50/50 web/local alternation
**high · small effort**

All three `selectFusedEvidence` callers pass only `limit` and `maxPerFile`, so both
stream weights default to 1 and web and local at the same native rank tie exactly.
The kind tiebreak resolves every tie toward web, so the candidate list strictly
alternates and an 18-slot pack becomes 9/9 regardless of the quality gap. Nine
mediocre vault chunks displace nine strong web results, or the reverse.
`/api/search` does not have this problem; `fuseFederatedSearch` uses 1.0/0.92/0.82.

Pass explicit weights at the three call sites, mirroring the federated ones, and
assert in a test that 18 strong web plus 18 weak local candidates is not 9/9.

### KIX-07 · Ask-path fusion drains held-back candidates with diversity fully disabled
**high · small effort**

`maxPerFile` and `maxPerHost` are enforced only on the first pass; the held-back
queue is then drained with diversity off, which lifts both caps and the overlap
duplicate check at once. A 20-chunk file plus one competitor at limit 10 yields 9
of 10 slots from one file. `fuseFederatedSearch` was fixed to relax progressively;
`selectFusedEvidence` was not.

Mirror the federated fix with a widening-tier loop, and keep the overlap check
active in every tier.

### KIX-08 · Exclusion terms and quoted phrases are raw substring tests
**high · small effort**

`haystack.includes(term)` with no word boundary means `-ai` deletes every chunk
containing "Details", "said" or "email", and `-test` deletes everything whose path
contains "test". These are hard AND filters applied before scoring, so the user
sees zero results with no explanation. The same rule lets a quoted phrase match a
path segment rather than content, and a phrase spanning a source line wrap can
never match.

Match excluded terms against the precomputed token sets rather than a raw string,
match phrases against a whitespace-collapsed content string, and keep the file path
out of the exclusion haystack.

### KIX-10 · Turning on concept search shrinks the evidence pack from 18 to 10
**high · small effort**

`evidenceLimit` and `maxPerFile` branch on `localRetrievalQueries.length > 1`, a
condition written for the "user named one saved document" case. Semantic expansion
also pushes that length above 1, so `semantic: true` silently drops the pack from
18 to 10 and raises `maxPerFile` from 2 to 4, while each branch's own limit falls
to 8. Enabling the feature meant to find more can strictly lose documents plain
BM25 already found.

Key the narrow-pack behaviour on the quoted-document-title signal it was written
for, and assert that `semantic: true` never returns a strict subset of the
`semantic: false` pack.

### KIX-11 · Web ranking reports coverage from the best-scoring variant, and the user's query can be evicted `LIVE`
**high · medium effort**

`rankWebResults` writes `queryCoverage` and `queryTermCount` from whichever derived
variant scored highest, and admission is gated on exactly those fields, so a page
matching a two-token sub-anchor reports coverage 1.0 and is admitted while covering
a fraction of the real question. Compounding it, `mergeRankingQueries` sorts
alphabetically and slices to 16, so with three discovery branches the user's own
query survives only if it sorts into the first 16.

Pin the user's query as element 0 before the slice and report coverage against it,
keeping the best-variant score for relevance only. Live data is needed to size how
often sub-anchor admission actually fires.

### KIX-12 · `engineAgreement` counts same-engine duplicates as agreeing engines `LIVE`
**high · small effort**

`fetchDiscoverySearchResults` flattens branch results, so one URL returned by a
single engine across three branches has its merge count raised to 3 while the
engine set stays at one. `engineAgreement` reads the larger of the two, awarding a
substantial ranking bonus for one engine's single opinion. Multi-branch fan-out
therefore systematically promotes whatever any one engine returned for more than
one branch, which is exactly the ambiguous-query case where cross-engine agreement
is supposed to help.

Make `engineAgreement` read distinct engine names only and keep the merge count for
diagnostics. The live envelope capture will show how often `engines[]` is populated.

### KIX-09 · Model-generated expansion queries are re-parsed through the operator parser
**high · small effort · security**

`expandLocalSearchQueries` returns model text straight into
`searchKnowledgeAcrossQueries`, and `searchKnowledge` unconditionally re-parses it.
A model emitting `path:`, `ext:`, `tag:`, `before:`, a leading `-term`, or a quote
silently converts that branch into a hard-filtered search, and those filters are AND
gates applied before scoring, so a stray token in a generated synonym can zero out
an entire branch. The user's raw query reaches the expansion prompt unescaped under
only a length cap, so a caller can steer what the model emits.

Add a parse-free entry point so `searchKnowledgeAcrossQueries` calls the scoring
core with inherited options directly, and route the parser only over text the user
actually typed.

## Evaluation infrastructure

### KIX-05 · The retrieval evaluation harness cannot grow or report valid numbers
**high · medium effort**

`loadRetrievalRegressionCorpus` asserts `schemaVersion === 1` and exactly 18 web
plus 18 vault candidates per case, so adding a single web-only, history-only or
documents-only case throws at module load and fails the whole file. `precisionAtK`
divides by `min(k, packSize)`, so a one-result pack containing one gold URL reports
P@5 = 1.0 — and the admission floors are precisely what produce thin packs. The
metric helpers are private to one test file, and `correctness-corpus.test.ts`
asserts exactly five cases, so the live corpus cannot grow either.

Bump the fixture to schema version 2 with per-case candidate counts and accept both
versions. Extract the metric primitives into `server/fixtures/retrieval-metrics.ts`,
divide by `k`, report `packSize` alongside, and add expected-in-top-k, source-kind
mix, and duplicate rate. Export `identity` and `displayWinner` from
`federated-search.ts` so duplicate rate matches production semantics. Relax the
corpus-count assertion while keeping the one-per-category invariant.

### KIX-18 · Run the deferred live evaluation pass `LIVE`
**medium · large effort**

Nothing in the repo has ever measured real retrieval quality. The runner grades
five correctness cases and emits no precision@k, MRR, top-3 gold hit, kind mix, or
end-to-end latency, and has no cap on outbound requests. Every offline fixture's
candidate distribution is currently a guess, which is what the KIX-11 and KIX-12
impact estimates rest on. `KEEPINDEX_SEARCH_MAX_RETRIES` now exists, so a 20-request
budget is finally enforceable at 1× rather than 3×.

The corpus is designed and costed: 14 cases, 19 SearXNG requests, with three of them
free because `target: vault` skips discovery entirely. Extend
`scripts/run-correctness-corpus.ts` rather than writing a new runner: wrap
`globalThis.fetch` to count SearXNG hits with a hard abort at the budget, add
spacing, clear the hydration cache between cases, assert the reported model per
case, and emit the KIX-05 metrics. Spend the first two requests capturing raw
SearXNG envelopes so every later fixture is grounded in real data.

### KIX-19 · The E2E search stub omits the response envelope, so `searchMeta` is always null
**medium · small effort**

The store sets `searchMeta` only when counts, available and semantic are all
present, and the stub returns just `results`. The degraded banner, the
concept-fused chip, the semantic warning and the candidate-count footer are
therefore never rendered in any browser test. The exact UI that tells a user their
web provider was down is untested end to end.

Enrich the stub from a live capture and add cases asserting the degraded banner and
the keyword-fallback chip render. Keep one stub variant per interesting state.

## Observability

### KIX-13 · Vault-only queries record a web relevance failure
**high · small effort**

With `target=vault` the ask path resolves a skipped web outcome and passes it
through without an `attempted: false` flag, so classification falls through to
`no-results` and a provider that was deliberately never called is persisted as a
relevance miss. Local is handled correctly. This corrupts the one signal the
evaluation corpus exists to read.

Add an `attempted` field to the diagnostics input, set it from `allowWeb` at both
call sites, and assert that `target=vault` yields `web.state === 'skipped'`.

### KIX-20 · A truncated answer is graded as ungrounded rather than truncated
**medium · small effort**

Every delta has already streamed by the time the finish-reason check runs, so the
user is looking at a partial answer. The throw skips grading entirely: no quality
frame, `grounding_json` persisted null, citation identifiers stored unvalidated. A
stream cut mid-bracket yields zero extractable identifiers, so the final claim reads
to any consumer as uncited rather than truncated.

Grade what was produced, emit the quality frame with an explicit truncated flag,
then emit the error. Persist the grounding record either way.

### KIX-21 · `/api/related` and `/api/takeaways` return 200 with an empty array on failure
**medium · small effort**

A null completion, a non-OK response, and a thrown error all produce an empty array
with status 200, byte-identical to a successful call that legitimately produced
nothing. There is no request id, no query record, and no telemetry write on either
path, so the failure leaves no trace and there is no way to notice the feature has
stopped working.

Add a status discriminator to the response body while keeping HTTP 200, and write
telemetry on the failure branch so the UI can say "follow-ups unavailable".

### KIX-15 · Source hydration is an uncounted second live-web budget
**medium · medium effort**

Each `/api/ask` can issue up to 18 sources × 4 requests = 72 outbound HTTP requests,
none of which appear in any telemetry field, diagnostics entry, or timing record.
`toPublicSource` strips the hydration metadata, so neither the client nor the
persisted record can tell an enriched snippet from a skipped or failed one. The
10-minute LRU is a module global the server never imports, so a corpus runner
talking over HTTP cannot clear it and request counts are not reproducible.

Count hydration fetches into a per-request tally surfaced in diagnostics and
timings, keep the hydration status on the public source, and add an env-gated
route that clears the cache so a live run can reset between cases.

### KIX-22 · Citation-namespace and attribution defects in the grader `LIVE`
**medium · medium effort**

Three defects on one surface. A model writing `[L1, 2]` has `2` resolved into the
web namespace with no invalid-citation flag, silently attributing a vault claim to a
web page. The local prompt entry writes a line range as `(L118-140)`, the same shape
as a citation identifier, so a copied coordinate becomes an out-of-range `[L118]`
that collapses the whole answer's grade. And the same-line quotation credit is gated
on an `RFC <number> states/defines` attribution, so byte-identical prose scores
100%/strong citing a web RFC and 50%/mixed citing a vault note, structurally
penalising local evidence and triggering spurious repair passes on local-only
answers.

Propagate a group's leading namespace across all members, change the prompt's line
coordinate to a non-citation shape such as `lines 118-140`, and generalise the
attribution pattern to accept a local source reference. Live vault-only runs are
needed to size how often the model emits each shape.

### KIX-14 · LLM timeouts are per candidate, and a fallback success rewrites the global default model
**high · small effort · correctness**

The timeout signal is constructed inside the candidate loop and a timeout is
swallowed rather than rethrown, so a 15-second budget across three candidates is
really up to 45 seconds, awaited inline before any results are produced. Separately,
a success on the fallback model sets the process-global active default, so one slow
request silently redirects every later call including answer generation, which also
invalidates cross-case comparison in an evaluation run.

Track a deadline outside both loops so the timeout means what it says, and scope
model fallback to the single request instead of mutating global state.

### KIX-23 · Indexing a source tree has no exclude patterns, so generated output crowds out the vault
**high · small effort · retrieval quality**

Observed after adding `/home/user/projects` as a second knowledge root: it
contributed 64,229 chunks against the Obsidian vault's 15,771 and hit
`MAX_INDEXED_CHUNKS` at exactly 80,000, so `capped: true` and part of the tree was
silently truncated. `node_modules`, `.git`, `dist` and `build` are correctly
excluded already, but nothing filters generated or archived content: one
experiment-results directory alone contributed 13,216 chunks, two `repomix-output`
dumps another 4,091, and a directory literally named `__NUKED` another 1,715. That
is a quarter of the entire index spent on material nobody wants retrieved, while
real notes fall outside the cap.

`server/index.ts` `indexDirectory` traversal and `MAX_INDEXED_CHUNKS`.

Add per-resource exclude globs, settable at index time and editable in the
knowledge panel, with a sensible default set covering generated output. Report
which patterns matched in the per-resource status alongside the existing skip
counters, and surface `capped: true` in the UI rather than only in the API payload,
so truncation is visible rather than silent. Consider a per-resource chunk budget
so one large root cannot starve the others.

## Performance

### KIX-16 · Local search re-tokenizes each surviving chunk body per query
**medium · medium effort**

An isolated synthetic 80,000-chunk benchmark put the BM25 inner loop with
precomputed term frequencies at roughly 19 ms, suggesting the linear scan is not
yet the bottleneck. Re-tokenizing a 1.1 KB chunk body cost about 30 µs per candidate
that cleared the coverage floor, or roughly 150 ms for 5,000 survivors and 600 ms
for 20,000, repeated per semantic branch. These figures are directional rather
than a hardware-neutral guarantee.

Score in two phases: rank by BM25 and the cheap boosts, then compute phrase,
proximity and metadata signals only for the top 3× limit. Hoist the metadata
tokenization out of the per-token filter and use a set. Re-measure across synthetic
indexes and representative local hardware before considering FTS5; the number that matters is how many candidates
survive the coverage floor, not the total chunk count.

## Product

### KIX-24 · Define a capability-scoped local plugin protocol before accepting external tools
**high · large effort · architecture, security**

KeepIndex has no plugin boundary today. Importing another product as an in-process
module would grant it the API process's filesystem, database, query, evidence-pack,
and provider access. Treating arbitrary MCP tools as trusted retrieval providers
would have the same problem with a more convenient wire format. A plugin system
must strengthen the local-first boundary rather than turn “local” into “anything on
the machine may read everything.”

Design the first protocol around out-of-process, read-only retrieval providers over
stdio or an explicitly configured Unix socket. A versioned manifest must declare an
id, protocol version, executable, content kinds, and narrowly enumerated
capabilities such as `search`, `read_excerpt`, `status`, and `subscribe_changes`.
No capability is implied. Do not load third-party JavaScript into the KeepIndex
process, pass browser-storage state, expose SQLite, or provide write tools in the
first protocol version.

Every result must carry stable provider/source identifiers, a display path, a
bounded excerpt, content hash, and citation coordinates. The host must enforce
request/response byte limits, deadlines, concurrency budgets, cancellation, crash
isolation, path and URL validation, and the same private-endpoint policy as local
inference. Plugin failures degrade one source; they cannot fail the federated
request or silently fall back to a network service. Configuration and health must
identify exactly which executable and protocol version are active without printing
tokens or environment contents.

Before shipping an SDK, write an architecture decision record and adversarial
contract tests for a hanging process, crash, malformed frame, oversized payload,
duplicate source id, path escape, public-network callback, prompt injection in an
excerpt, cancellation race, and restart. Add explicit enable/disable UI and a
per-plugin source filter. A plugin should be installable as an optional Compose
profile or local executable; the one-command base image remains independent.

### KIX-25 · Add an optional Obsidian CLI adapter without weakening direct vault indexing
**medium · medium effort · knowledge integration**

The current direct adapter correctly recognizes a vault from `.obsidian`, reads
Markdown without launching the desktop app, and indexes aliases, tags, wiki links,
content, and line coordinates. That must remain the portable, offline baseline.
Requiring a GUI process or a particular community plugin would make server and
container installs worse.

Investigate the official Obsidian CLI available on the user's platform behind the
KIX-24 provider contract. Detect its version and capabilities at runtime; never
assume the executable exists. Use it only where it adds verified information the
filesystem adapter cannot recover reliably—for example canonical vault resolution,
stable note identity, resolved links, properties, or incremental change signals.
If the CLI is missing, too old, or the desktop app is closed, indexing must continue
through the current read-only path with an explicit capability status rather than a
failure or UI automation workaround.

The first adapter is read-only. It may not create, rename, edit, or delete notes,
change Obsidian settings, install a community plugin, or open arbitrary URI actions.
Normalize CLI and filesystem results into one source identity so the same note is
not counted or cited twice. Benchmark recall, update latency, line-coordinate
stability, and cold-start cost on synthetic vaults before making the CLI path the
preferred adapter. Container documentation must explain that a desktop-local CLI
usually belongs on the host and requires an explicit bridge; it is never bundled
silently.

### KIX-26 · Make Notient the first external provider after its read contract stabilizes
**high · medium effort after KIX-24 · integration**

Notient is a strong first consumer because its current design already has a vault
adapter, a per-vault daemon, authenticated session identity, ranked `search.run`,
bounded `notes.read`, `vault.extraction`, `vault.stats`, and a read-oriented MCP
surface. It can contribute graph-expanded note retrieval, extracted concepts,
claims, questions, and chunk-anchored evidence that direct BM25 does not provide.
It also exercises the exact boundary a general plugin host needs.

Do not integrate by importing Notient's source, reading its SurrealDB files, sharing
an administration token, or coupling KeepIndex to its unversioned Unix-socket
implementation. The project is actively changing and is still marked alpha. Wait
for a tagged, documented read contract, then build a separate adapter speaking the
least-powerful stable surface—preferably the versioned plugin protocol mapped to
Notient's read-only MCP/RPC methods.

The adapter identity should be `keepindex`, authenticated as a non-human read-only
principal. It must never request note-write, approval, awaken, reindex, session
grant, or admin capabilities. Users explicitly select a vault and start/authorize
Notient; KeepIndex must not auto-spawn a mutable daemon without consent. Map Notient
paths, chunk ids, snippets, and extraction evidence into KeepIndex citations while
preserving `provider: notient` provenance.

Resolve duplicate ownership before implementation: a vault is either indexed
directly, searched through Notient, or deliberately fused with canonical
content-hash deduplication. Do not let two indexes manufacture independent-source
agreement for one note. Required contract tests cover daemon absence, protocol
version mismatch, expired authorization, partial stream, duplicate chunks, stale
note coordinates, Notient restart, and strict no-write/no-public-network behavior.
Ship it as an opt-in plugin/profile with independent health and removal; disabling
it leaves the core KeepIndex index untouched.

### KIX-27 · Evaluate AnyDoc as the deterministic Office parser
**high · medium effort · document intelligence, portability**

AnyDoc is the closest examined match for KeepIndex's small Bun/container
architecture: a Rust parser with Node N-API bindings, broad Office and
OpenDocument coverage, structured tables, and embedded assets. It is not yet a
dependency. Prove the pinned binding under Bun on Debian amd64 and arm64 before
changing extraction.

Keep direct text/code handling unchanged. Compare AnyDoc with the current Pandoc
output for DOCX, ODT, RTF, and EPUB using synthetic golden documents; retain
Pandoc until parity is demonstrated. Add presentation and spreadsheet formats
one family at a time with corrupt-container, decompression-limit, file-size, and
chunk-volume fixtures. Keep `pdftotext` as the page-aware PDF route during this
work. Any hosted OCR option must be unreachable, and a fatal-network harness
must prove extraction cannot upload a document.

### KIX-28 · Add citation-grade provenance and an incremental file manifest
**high · large effort · retrieval architecture**

Current non-PDF coordinates describe generated extraction lines, while richer
parsers can report pages, bounding boxes, reading order, and asset identities.
Define a KeepIndex-owned segment schema that explicitly distinguishes
`source-page`, `generated-line`, and `metadata-only` provenance, plus a `derived`
flag for OCR or model output. Never label generated Markdown lines as original
page coordinates.

Add a SQLite file manifest keyed by resource and contained path with size, mtime,
content hash, extractor/version, options hash, last successful extraction, and
bounded error kind. Reuse chunks only when those identities match, generate
stable chunk ids, atomically replace changed/deleted files, and preserve the last
good extraction if a new attempt fails. This provides safe incrementality without
replacing BM25, fusion, grounding, or the durable query-record design.

### KIX-29 · Offer Docling as a hardened opt-in document profile
**medium · large effort after KIX-28 · OCR, layout, containers**

Docling is the strongest examined option for scanned PDFs, reading order, tables,
figures, formulas, page images, and bounding-box provenance, but its useful local
stack is too large and model-license sensitive for every installation. Package it
only as an explicit `document-ai` Compose profile after image-size, cold-start,
architecture, and transitive-model-license review.

The sidecar must have no published port or arbitrary URL/path input. Run it as a
fixed non-root uid with a read-only root, dropped capabilities, no-new-privileges,
resource limits, a bounded tmpfs, and concurrency one. Pre-bake pinned artifacts,
force offline model settings, deny runtime egress, cap pages and input bytes, and
enforce a 90–120 second deadline. Remote services and external plugins stay off.
Absence, timeout, malformed output, or OOM degrades one extraction and falls back
without corrupting the existing index.

### KIX-30 · Add bounded local multimodal enrichment without mutating evidence
**medium · large effort after KIX-28 · vision, grounding**

Once page and asset provenance is stable, allow an opted-in local multimodal model
to describe a bounded set of page crops, figures, or tables. Reuse the same private
inference endpoint policy and redirect rejection as answer generation across
native Ollama and OpenAI-compatible local runtimes. Do not accept a parser's raw
remote-service configuration.

Impose pixel, byte, page, image-count, token, timeout, and concurrency budgets.
Store descriptions separately with model id, asset hash, and `derived: true`;
canonical source text remains unchanged. Retrieval may use derived descriptions,
but citations must resolve to the original document page and image coordinates.
Prompt injection inside OCR, captions, and source images remains untrusted evidence.
The detailed decision record is `docs/DOCUMENT-INTELLIGENCE.md`.

## Long-term product direction

Axis 4 of the KeepIndex product thesis remains unimplemented: nothing a user saves,
pins, repeats, or clicks influences retrieval, beyond collection host preferences
feeding `hostPreferenceScore`. The tenth query on a topic is not yet better than the
first. That is still the largest available differentiator, and it is now much safer
to build on, because the retrieval path has regression coverage and the evaluation
harness needed to prove a personalization change actually helps is one item away
(KIX-05).
