# Document intelligence direction

KeepIndex's first public release indexes trustworthy text. It extracts ordinary
text and code directly, uses `pdftotext` for page-aware PDF text, and uses
Pandoc for DOCX, ODT, RTF, and EPUB when available. A local model may advertise
multimodal capability, but KeepIndex does not yet send page images or figure
crops to it. The UI and documentation must not imply otherwise.

This note records the 2026-08-29 evaluation of four possible improvements:
AnyDoc, Docling, OpenRAG, and paper-to-md. It is a proposal for owner approval,
not a declaration that those tools ship in the base image.

## Recommendation

| Candidate | Decision | Reason |
| --- | --- | --- |
| AnyDoc | Best near-term parser candidate | Small Rust core, broad Office support, structured tables and embedded assets, and a viable Node N-API surface without a Python service |
| Docling | Later opt-in Compose profile | Best examined option for OCR, reading order, page geometry, tables, figures, and provenance, but materially heavier and model-license sensitive |
| OpenRAG | Architecture reference only | Useful ingest-run, stable-id, deduplication, and cleanup ideas, but its full application stack would replace rather than extend KeepIndex |
| paper-to-md | Do not integrate | PDF-only focus, model-rewritten text, cloud-first defaults, credential-mounting deployment, and service security issues conflict with KeepIndex's evidence and privacy contracts |

The recommended release boundary is deliberate: keep the Docker-only base
small and deterministic, improve Office parsing only after a pinned native
binding passes portability gates, and add visual extraction as an optional
offline subsystem rather than making every user pull several gigabytes of
models and Python dependencies.

## Invariants for every parser

A parser may enrich extraction, but it may not bypass or replace:

- indexed-root containment;
- symlink rejection and credential-file exclusion;
- the 32 MiB document input limit and bounded subprocess output;
- corpus file/chunk limits;
- SQLite durability and atomic snapshot replacement;
- BM25 admission, ranking, fusion, and diversity behavior;
- evidence-pack budgets and source provenance;
- prompt-injection treatment of retrieved text;
- citation validation and the post-generation grounding gate;
- offline/degraded behavior when an optional parser or model is absent.

Canonical evidence must remain source-derived. OCR and model-generated figure
descriptions are untrusted derived fields. They may help retrieval, but they
must never silently replace original text or be cited as though a model's
description were printed in the source.

## AnyDoc adoption gate

AnyDoc is the closest fit for the existing TypeScript/Bun application. Its
document model can preserve headings, lists, notes, logical tables, merged
cells, formulas, and embedded Office assets across a substantially broader set
of formats than the current converter.

An approved integration should:

1. Pin a reviewed AnyDoc package version in `bun.lock`; never use `npx` or
   download a converter at application startup.
2. Prove the N-API package under Bun in Debian containers on amd64 and arm64.
3. Route DOCX, ODT, RTF, and EPUB through AnyDoc first while retaining Pandoc
   as a measured fallback until golden fixtures establish parity.
4. Add PPT/PPTX, XLS/XLSX/XLSB, ODS/ODP, and older binary Office formats only
   with per-format malformed-input, file-limit, and chunk-volume tests.
5. Retain `pdftotext` as the page-aware PDF route until a synthetic comparison
   corpus proves that another path preserves or improves citation coordinates.
6. Make AnyDoc's hosted OCR option unreachable. A document requiring OCR must
   produce an explicit local result or be offered to the optional offline
   document-intelligence profile.
7. Preserve the outer KeepIndex limits before invoking the parser, even when
   the parser has its own decompression and XML safety limits.
8. Label Office Markdown coordinates as generated lines, never source pages.

Required tests include corrupt ZIP/OLE containers, encrypted inputs,
decompression bombs, deterministic snapshots, `NeedsOcr`, a fatal-network
harness, and regressions for credential exclusion, path containment, symlinks,
and source hydration.

## Provenance and incremental indexing

Rich document search needs an extraction contract before it needs a vision
model. A future record should be able to distinguish:

```text
extractor
extractor_version
provenance_kind: source-page | generated-line | metadata-only
content_sha256
segments[]:
  text
  kind
  page?
  bbox?
  coordinate_origin?
  generated_start_line?
  generated_end_line?
  asset_ref?
  derived: false | true
```

The corresponding file manifest should record resource id, contained file
path, size, modification time, content hash, extractor/version, options hash,
last successful extraction, and bounded failure kind. Re-indexing can then hash
only changed candidates, reuse compatible successful output, generate stable
chunk identities, atomically replace changed/deleted files, and preserve the
last good extraction when a new parser attempt fails.

Stable identities and ingest-run cleanup are the useful OpenRAG ideas. Its
OpenSearch, Langflow, cloud connector, telemetry, provider-onboarding, and
multi-service application stack are explicitly outside KeepIndex's design.

## Optional Docling profile

Docling is the strongest examined foundation for scanned PDFs, OCR, layout,
reading order, tables, formulas, figures, page images, bounding boxes, and
coordinate-aware provenance. It should not be a dependency of the default
image.

An eventual `document-ai` Compose profile must:

- run only on the internal Compose network, with no published service port;
- use a fixed non-root uid, read-only root filesystem, dropped capabilities,
  `no-new-privileges`, bounded tmpfs, and explicit CPU/memory/PID limits;
- accept file bytes or opaque ids from KeepIndex, never arbitrary URLs or host
  paths;
- reapply the 32 MiB input cap, add a page cap, use a 90–120 second deadline,
  and default to concurrency one;
- mount no complete home directory or browser profile;
- pre-bake pinned, license-reviewed artifacts and run model tooling in offline
  mode with runtime egress denied;
- keep remote services and external plugins disabled;
- return a narrow KeepIndex-owned schema;
- fail back to the deterministic parser without corrupting the previous index;
- surface “advanced parser unavailable” as a source-specific degraded state.

The base command remains `docker compose up --build`. Enabling a later document
profile must be an explicit operator choice.

## Local multimodal enrichment

After page/figure provenance is stable, KeepIndex can optionally describe a
bounded set of page crops, tables, or figures through the same local inference
transports already used for grounded answers. The inference URL must pass the
existing private-endpoint policy and redirect rejection; raw parser-supplied
remote URL options are not accepted.

The first multimodal protocol should impose pixel, byte, page, image-count,
token, timeout, and concurrency budgets. Generated descriptions should be
stored separately with model id, source asset hash, and `derived: true`.
Search results and citations must lead back to the original document page and
image coordinates.

## Explicit non-adoptions

OpenRAG is not a KeepIndex dependency or deployment component. paper-to-md is
not a parser, sidecar, or source of canonical evidence. Useful deterministic
ideas—stable chunk ids, failed-run cleanup, caption-region figure crops—may be
implemented independently behind KeepIndex's own bounded interfaces and
synthetic tests.

The tracked roadmap items are KIX-27 through KIX-30 in `docs/ROADMAP.md`.
