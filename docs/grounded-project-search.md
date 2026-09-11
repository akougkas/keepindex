# Grounded project and release search

KeepIndex retrieves evidence before asking the selected AI endpoint to answer. A named release question must keep its project identity through discovery, ranking, source selection, and synthesis. Words such as “latest,” “release,” and “features” are aspects of the question; they must not admit unrelated pages on their own.

## Current evidence

For a named project, KeepIndex reads the current `README.md` and `CHANGELOG.md` inside registered local roots. It checks immediate children and one grouping level, with limits on directories, file size, and passages. It does not follow project or document symlinks outside those roots. This bounded read supplements capped or stale index snapshots; it does not claim to refresh the entire index. A release section stays separate from general product capabilities.

When web search identifies an exact public GitHub repository, KeepIndex fetches its current release record through GitHub's API. The fetch has a timeout, byte limit, credential-free transport, response validation, and a short cache that retains the original fetch time. Release metadata must belong to the same repository. A fresh release record replaces stale search snippets. Once the repository is identified, additional discovery queries stop.

Local-only targets do not invoke web retrieval or public source hydration. A local changelog describes the checkout; its date is not necessarily the GitHub publication date. The answer must distinguish those dates and avoid claiming a verified latest publication from local files alone.

## Answer checks and presentation

The source list sent to the browser is the same numbered evidence pack used for synthesis. Release prompts place evidence in the user message, keep instructions concise, and request a short, cited answer. The pack avoids unrelated implementation fragments, broad ecosystem pages, and general feature summaries when current release documents exist.

Before completion, KeepIndex checks that citations resolve, that claim-level citation coverage meets the threshold, and that cited passages contain claimed version numbers, ISO dates, and code identifiers. For a current release lookup with one live record, the answer must report the record's version. These deterministic checks are useful error detectors, not semantic proof of every sentence. The UI therefore calls the metric **citation coverage**, not a factual-accuracy or grounding percentage.

When a release synthesis fails, KeepIndex can show exact source excerpts, explicitly labelled **Source excerpts**, using available release metadata and a quoted changelog paragraph. It does not issue repeated model repair calls. If no suitable fallback exists, the server clears the draft and sends `done` with `grounded: false`. The browser discards the unverified text and does not generate follow-ups, save an answer, or add a completed journey node.

Short answers have no redundant takeaway section. Longer answers can expose existing cited sentences as takeaways without another AI generation. Follow-up responses must be structured questions rather than arbitrary prose parsed as a list.

## Regression and live validation

Automated regressions cover subject preservation, unrelated same-name products, generic “features” pages, public repository hydration, repository substitution, local-only reads, stale-file refresh, symlink boundaries, invented versions with valid-looking citations, useful excerpt fallback, and browser-store rejection handling. The `/api/ask/stream` facade is exercised in the fallback integration test.

Live acceptance requires checking the resulting claims against the actual selected sources. A passing citation score alone is insufficient. See `docs/validation/2026-09-11-grounded-search.md` for the measured ZBook deployment results and remaining limits.
