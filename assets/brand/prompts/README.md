# KeepIndex image-generation prompts

These prompts are production briefs for generating supporting raster imagery around the canonical KeepIndex identity. They do not authorize a model to redraw the logo, typeset the wordmark, or invent product UI. The vector masters in the parent directory remain the source of truth.

## Workflow

1. Attach `../keepindex-mark.svg`, `../keepindex-lockup.svg`, and, when supported, the desired light or dark wordmark as image references.
2. Paste `00-shared-constraints.md` before one numbered prompt.
3. Replace every bracketed production variable. Keep the random seed and model version when the tool exposes them.
4. Generate without text. Add the real SVG wordmark and live typography later in Figma, a browser, or another deterministic layout tool.
5. Save candidates outside the repository until they pass the review checklist below. Never replace the SVG masters with an image-model approximation.

## Suggested output manifest

Record this beside any selected derivative:

```yaml
asset: keepindex-[campaign]-[orientation]-v01.png
prompt: assets/brand/prompts/[prompt-file].md
prompt_version: 1.0.0
model: [provider/model/version]
seed: [seed or unavailable]
size: [pixel dimensions]
source_references:
  - assets/brand/keepindex-mark.svg
post_processing: [crop/color/retouch operations or none]
reviewed_for:
  - no generated text
  - no invented logo
  - no private data or real browser content
  - no prohibited visual metaphor
  - sufficient text-safe contrast
license_notes: [provider terms and human review]
```

## Acceptance checklist

- The work feels private, precise, editorial, and materially grounded—not mystical or “AI magical.”
- The palette is dominated by dark ink (`#071117`) and warm ivory (`#F2EFE6`), with evidence green (`#62D66B`) used as a single directional accent.
- Four inputs remain visually distinct until they converge; one green result emerges.
- There is no magnifying glass, padlock, castle, column, sparkle, robot, chat bubble, brain, cloud, or generic neural-network mesh.
- No fake text, pseudo-letters, fake citations, browser chrome, fake search results, or model-generated KeepIndex mark appears.
- The composition leaves the requested text-safe region genuinely quiet.
- Any people, documents, or screens are fictional and contain no legible personal data.
- The asset still works when desaturated; the structure—not color alone—carries the idea.

Selected raster work belongs in a clearly named campaign subdirectory with its manifest. Concept contact sheets and rejected generations stay untracked.
