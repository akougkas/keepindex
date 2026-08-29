# KeepIndex brand assets

This directory contains the production identity masters for KeepIndex. The system is vector-first: the mark, wordmarks, lockups, and social card are deterministic SVG files, while PWA PNGs are reproducible derivatives of the public SVG icon. Visible lettering is committed as vector outlines generated from the locked `@fontsource-variable` WOFF2 files, so standalone assets never depend on fonts installed on the viewer's machine.

## Asset index

| Asset | Intended use |
| --- | --- |
| `keepindex-mark.svg` | Primary full-color symbol on any surface that can preserve its dark field |
| `keepindex-mark-monochrome.svg` | One-color print, emboss, engraving, and accessibility-constrained contexts |
| `keepindex-wordmark-dark.svg` | Horizontal wordmark on light or warm-neutral backgrounds |
| `keepindex-wordmark-light.svg` | Horizontal wordmark on dark-ink backgrounds |
| `keepindex-lockup.svg` | Primary brand lockup with the canonical promise and domain |
| `keepindex-domain-lockup.svg` | Campaign/domain treatment with `.ing` in green |
| `social-card.svg` | `1200×630` Open Graph and repository social artwork |
| `prompts/` | Versioned briefs for generating supporting raster campaign imagery |

Application assets live under `public/`:

| Asset | Size / purpose |
| --- | --- |
| `public/keepindex-icon.svg` | Scalable favicon and PWA master |
| `public/keepindex-maskable-icon.svg` | Safe-zone master for maskable launchers |
| `public/icons/keepindex-192.png` | PWA icon, `192×192` |
| `public/icons/keepindex-512.png` | PWA icon, `512×512` |
| `public/icons/keepindex-maskable-512.png` | Maskable PWA icon, `512×512` |
| `public/icons/apple-touch-icon.png` | Apple touch icon, `180×180` |

## Reproduce vector and raster assets

The generator first uses Bun and `fontkit` to rebuild every SVG master from the locally installed Bricolage Grotesque and Figtree WOFF2 packages. Mark geometry lives in that generator as one canonical construction, including the protected central weave. Lettering is converted to paths; generated SVGs contain no visual `<text>` elements or host-font references.

ImageMagick then renders the two public SVG icon masters at high density, resizes them to the exact target, strips ancillary metadata, and writes 8-bit sRGB PNGs.

```bash
./scripts/generate-brand-assets.sh
```

Set `CONVERT_BIN` when the ImageMagick executable has another name:

```bash
CONVERT_BIN=magick ./scripts/generate-brand-assets.sh
```

After regeneration, confirm dimensions and inspect every icon at `16`, `32`, `180`, `192`, and `512` pixels. Never commit a raster that was resized from an image-model interpretation of the mark.

To verify the committed vectors byte-for-byte without writing files:

```bash
bun run brand:check
```

The dependency lockfile pins `fontkit` and both source-font packages. Do not edit generated path data by hand; change `scripts/generate-brand-vectors.mjs`, regenerate, and inspect the result instead.

## Source-of-truth rules

- Product prose is `KeepIndex`; the visual wordmark is `keepindex`; the CLI is `keepidx`.
- The exact promise is “Search your world. Keep it yours.”
- Do not typeset a replacement wordmark from memory or generate one with an image model.
- Do not alter one path independently. The four ivory inputs and one green output are semantic, not decorative.
- Supporting generated imagery must follow `prompts/README.md`, contain no generated words, and pass human review before entering this directory.
- Concept sheets, malformed text, test screenshots, and design-reference images are not production assets and must remain untracked.

Construction, color, spacing, naming, typography, monochrome rules, and misuse examples are specified in [`../../docs/BRAND.md`](../../docs/BRAND.md).
