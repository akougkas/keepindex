# KeepIndex identity system

KeepIndex has one identity and one promise.

```text
keepindex
Search your world. Keep it yours.
keepindex.ing
```

The product descriptor is **“Private search on your computer. Your choice of AI.”** Keep this language consistent across product, documentation, packaging, and release communications.

## Brand story

“Keep” carries two meanings.

First, it is a verb: people keep control of their searches, settings, history, indexed knowledge, and evidence records. KeepIndex does not turn private context into a corporate training or advertising asset.

Second, a keep is the protected inner stronghold. The index lives inside a boundary the user owns: a laptop, workstation, gaming rig, or homelab. The metaphor is expressed through structure and containment, never through a literal castle or padlock.

“Index” names the retrieval architecture. Web results, a private vault, local documents, and opt-in browser history remain distinct evidence paths until KeepIndex admits, ranks, and fuses them. The domain turns the name into the phrase “keep indexing.”

## Naming and capitalization

| Context | Required form |
| --- | --- |
| Product name in prose | `KeepIndex` |
| Visual wordmark | `keepindex` |
| Package name | `keepindex` |
| CLI executable and technical short form | `keepidx` |
| Domain | `keepindex.ing` |
| Repository | `akougkas/keepindex` |
| Environment prefix | `KEEPINDEX_` |
| Browser-storage prefix | `keepindex-` |
| Backup schema | `keepindex-state-backup` |
| CSS/DOM and PWA namespace | `keepindex` |
| Human-facing logs / machine namespace | `KeepIndex` / `keepindex` |

Never write “Keep Index,” “Keepindex,” “KeepIndexing,” or invent another short form. “Keep indexing.” is an approved campaign line when the domain treatment completes the phrase; it is not the product name.

## The mark

The mark is a woven K/I lattice built on a `64×64` coordinate system.

- A `60×60` dark-ink field begins at coordinate `(2,2)` with a `14`-unit corner radius.
- Every primary strand has a `6`-unit stroke, round caps, and round joins.
- Four warm-ivory paths enter independently. They represent web, vault, local documents, and browser history; the mark does not assign a permanent direction to an individual source.
- The central over-under bridge is deliberately compact. It represents a bounded evidence pack inside the user-controlled keep.
- Exactly one evidence-green path exits at lower right. It represents the grounded, cited answer—not model “magic.”
- Consistent endpoints and open negative space keep the structure legible at `16 px`.

The symbol may suggest K and I, convergence, and a protected internal weave. Do not explain it as a lock, castle, shield, chatbot, neural network, or search icon.

## Clear space and minimum size

Use one eighth of the mark width—`8` construction units—as minimum clear space on every side. For a `32 px` mark, that is `4 px`; for a `64 px` mark, it is `8 px`.

- Digital mark minimum: `16×16 px`.
- Print mark minimum: `5 mm` high, subject to proofing.
- Horizontal wordmark minimum: `104 px` wide digitally or `28 mm` in print.
- Primary lockup minimum: `320 px` wide digitally. Below that, separate the mark/wordmark from the tagline rather than compressing the lockup.

Do not let borders, text, photography, or other logos enter the clear-space area. Maskable launcher assets already include their required safe zone; do not crop them again.

## Color

The static identity tokens are also declared in `src/index.css`:

| Token | Hex | Meaning |
| --- | --- | --- |
| `--brand-ink` | `#071117` | Protected field, primary dark surface |
| `--brand-ivory` | `#F2EFE6` | Source strands and primary light identity |
| `--brand-green` | `#62D66B` | Grounded evidence path and dark-mode emphasis |
| `--brand-stone` | `#A7A59B` | Secondary metadata and quiet construction detail |

The application’s semantic `--background`, `--foreground`, and `--primary` tokens adapt by theme for accessible UI contrast. Static assets retain the four exact identity colors above.

Green is directional evidence, not ambient decoration. Use it for the emerging path, the second sentence of the promise on dark campaign fields, `.ing` in a domain treatment, and concise active states. Do not distribute it evenly across every strand or turn the identity into a green glow.

Purple or rainbow “AI” gradients are outside the system. Subtle, single-hue green atmosphere may appear only at low opacity on dark ink.

## Typography

KeepIndex typography has three jobs:

1. **Editorial identity and display:** Bricolage Grotesque Variable. Use confident weight, tight optical tracking, and large scale for the promise and wordmark-adjacent headlines. The reference hero uses this family for its distinctive compact curves and direct tone.
2. **Humanist interface and reading:** Figtree Variable. Use it for controls, prose, results, settings, citations, and long-form research.
3. **Technical treatment:** a platform monospace stack. Reserve it for `keepidx`, environment variables, status labels, keyboard hints, paths, and machine-readable output.

Do not set ordinary UI prose in monospace. Do not replace the editorial face with a generic system sans. The wordmark is always lowercase and visually tighter than body copy.

## Wordmark and lockups

The product wordmark is the single word `keepindex`, in one color. It does not split “keep” from “index” with color, capitalization, spacing, or punctuation.

Use:

- `keepindex-wordmark-dark.svg` on ivory, white, or sufficiently light neutral fields;
- `keepindex-wordmark-light.svg` on dark ink or sufficiently dark photography;
- `keepindex-lockup.svg` when the complete mark, promise, and domain can breathe;
- `keepindex-domain-lockup.svg` only for domain/campaign contexts.

The domain may distinguish `.ing` in green. That treatment belongs to `keepindex.ing`; it must not turn the product wordmark into “keepindex” plus a green suffix in ordinary naming.

## Promise and supporting copy

The canonical promise is verbatim, including punctuation and capitalization:

> Search your world. Keep it yours.

Do not rewrite it as “Search your world, keep it yours,” “Your world. Your search,” or another approximation.

Approved supporting copy:

- Private search on your computer. Your choice of AI.
- Your sources. Your models. Your evidence.
- Web, vault, documents, and private browser memory—ranked together, kept local.
- Local inference. Inspectable citations. No cloud fallback.
- Keep indexing. *(campaign only)*

Avoid absolute security claims such as “perfectly private,” “unhackable,” or “anonymous.” Local-first describes architecture and control, not immunity from a misconfigured firewall or compromised host.

## Monochrome usage

Use `keepindex-mark-monochrome.svg` for one-color print, emboss, deboss, engraving, stamps, and contexts where green is unavailable.

- On light stock, render the mark in dark ink.
- On dark stock, reverse the entire mark to ivory.
- Preserve all five paths and their spacing. In monochrome the output is distinguished by direction and geometry rather than hue.
- Never convert only the green path to a tint that disappears at small size.

## Domain treatment

Write the domain as lowercase `keepindex.ing`. In display contexts, `.ing` may be evidence green while `keepindex` remains ink or ivory. In URLs, code, accessibility labels, and running prose, keep the domain as one uninterrupted string.

The public domain is a project, landing, and documentation identity. It is HSTS-preloaded and must be linked with `https://`. Do not imply that the unauthenticated private API is publicly hosted there. Remote authenticated access is future work.

## CLI treatment

The executable is always `keepidx` in lowercase monospace. Command names and flags follow it in the same technical voice:

```text
keepidx start
keepidx doctor
keepidx status --json
```

Human-facing CLI headings may say `KeepIndex`; log prefixes and temporary filenames use lowercase `keepindex`. Never abbreviate the CLI as `kidx`, `kpndx`, `kpdx`, or `knxng`.

CLI output should feel quiet and operational: no ASCII-art logo, animated spinner in script mode, emoji dependency, or marketing sentence between status fields.

## Misuse

Do not:

- redraw, rotate, skew, stretch, outline, bevel, or add effects to the mark;
- recolor input paths independently or add more than one green output;
- put the mark inside a padlock, shield, castle, magnifying glass, chat bubble, brain, sparkle, or cloud;
- substitute generated pseudo-lettering for the production wordmark;
- place the mark on busy imagery without its dark field or sufficient contrast;
- crop endpoints, collapse clear space, reduce the mark below `16 px`, or use the maskable asset as an ordinary tight-crop icon;
- split, title-case, hyphenate, or translate the wordmark;
- pair the identity with purple AI gradients, neon cyberpunk motifs, or generic neural meshes;
- use the canonical promise with changed words or punctuation;
- use retired, alternate, or experimental product names.

## Generated and photographic assets

Image models may create supporting backgrounds, material studies, and editorial photography, but never production wordmarks or final UI. Use the versioned briefs in `assets/brand/prompts/`, supply the canonical SVG references, suppress generated text, record model/version/seed metadata, and keep rejected contact sheets out of Git.

Every selected image requires a privacy review for accidental personal information, a geometry review when the mark appears, a license review, and a real-text compositing pass using the source SVG and project fonts.
