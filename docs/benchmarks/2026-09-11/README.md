# ZBook local model comparison

This comparison tests models through the existing Lemonade public API on ZBook.
It evaluates compatibility, grounded answer synthesis, and supporting-document
selection. It is a focused KeepIndex workload screen, not an exhaustive survey
of Hugging Face or a reproduction of a vendor's benchmark.

## Results and deployment decision

The release artifacts contain **357 recorded trials**, covering **11 model
files and 14 configurations**. Ten initial configurations completed 24 trials
each; Qwen 3.8 27B stopped after nine recorded trials. Three additional
temperature-0.1 profiles completed 36 trials each.

- [Measured matrix](matrix.md): strict answer outcomes, document selection,
  latency, and configuration differences.
- [CSV](matrix.csv) and [summary JSON](summary.json): machine-readable metrics.
- [Raw answers and scores](scored-results.json): synthetic evidence responses,
  model provenance, runtime settings, seeds, token counts, and timings. No
  private source packs or model reasoning text are included.

**Retain Gemma 4 26B A4B with MTP as the conservative existing default on this
128 GB ZBook.** It scored 14/16 strict answer passes and 8/8 selection passes
in the initial profile, with 1.60-second median answer latency. This is a
measured deployment choice, not a claim that it is universally more accurate.

**Gemma E2B QAT is the fastest compact candidate** in this screen: 2.44 GiB of
weights, 0.66-second median answers, and 88.1 backend-reported tokens/second in
the initial profile. **E4B QAT is another useful compact candidate**: 3.93 GiB,
1.41-second median answers, and 54.1 tokens/second. Both initially scored 13/16
strict answer passes. E4B selected the correct document set in all eight initial
trials; E2B incorrectly selected a biography-free directory for a birth-date
query once. The lower-temperature follow-up is reported separately, without
selectively pooling a model's best trials.

Qwen 3.5 4B is a viable alternative to evaluate: 12/16 strict answers and 8/8
selections, but slower here than the compact Gemma candidates. Neither Granite
profile establishes a reason to replace the working default in this specific
non-thinking workload. Context-1 loads on the existing Lemonade ROCm backend
and passes the eight initial selection trials, but its selection latency and
unavailable original agent harness do not justify inserting it into every query.

No tested model passed the repetitive long-pack case. Small-model speed does
not establish equal accuracy on arbitrary local questions. Keep every model
selectable and keep the evidence checks active; do not automatically switch
models or remove the larger working baseline based on this small screen.

## Environment and model provenance

- AMD Ryzen AI MAX+ PRO 395, Radeon 8060S integrated GPU (gfx1151), 128 GB RAM.
- Windows-hosted Lemonade 11.9.0; ROCm llama.cpp backend.
- KeepIndex runs locally in Docker; benchmark requests use Lemonade's public API.
- Exact Hugging Face repositories, immutable revisions, GGUF filenames, sizes,
  and SHA-256 identities are recorded in [models.json](models.json).
- Installed weight size is not runtime memory. Lemonade's host-wide memory
  counter includes other applications and is not attributed to the model.
- Release recency is established from official model repositories/cards. A new
  community upload timestamp alone does not establish a newer base model.

The shortlist includes [Gemma 4 QAT](https://huggingface.co/google/gemma-4-E4B-it-qat)
at E2B and E4B sizes, [Granite 4.2](https://huggingface.co/ibm-granite/granite-4.2-3b)
at 3B and 8B, and [Qwen 3.5](https://huggingface.co/Qwen/Qwen3.5-4B)
at 2B, 4B, and 9B. Granite's official card dates 4.2 to August 25, 2026.
The small Qwen 3.5 models remain relevant even though newer Qwen generations
exist at larger sizes; the already installed Qwen 3.8 27B is a separate baseline.
Existing Gemma E4B and Gemma 26B A4B with MTP provide comparisons against models
that were already available on this computer. This selection does not establish
that untested 0.8B models, other families, quantizations, or reasoning modes are
inferior.

## Procedure

The benchmark uses twelve frozen cases, with two seeds per model during the
initial comparison. Eight cases test cited answers: exact local facts, stable
release identity/date, missing evidence, source conflicts, document injection,
two-document joins, arithmetic, and a relevant fact inside a long distractor
pack. Four cases test document selection: project identity, a two-document
join, injection resistance, and no supporting evidence.

All source material is synthetic and is checked into
[model-benchmark.ts](../../../server/model-benchmark.ts). No private files,
browser history, or live internet retrieval enter this model comparison. The
same corpus, prompts, and scoring rules apply to every model; artifacts include
corpus and prompt hashes. The earlier Qwen 2B pilot is excluded from the formal
results; it was used to check the harness and clarify the injection case's
output contract before freezing the comparison.

Each model is loaded separately with a 16,384-token context, one inference slot,
512 batch tokens, and 256 microbatch tokens. Load options are transient;
existing saved model settings are preserved. A warmup is excluded from scored
cases. Requests disable prompt-cache reuse, request non-thinking output,
allow up to 1,024 generated tokens, and ask for answers of at most 100 words.
Context-1 additionally requests low reasoning effort because its GPT-OSS
architecture can generate reasoning independently of the non-thinking template
flag. Reasoning text is not written to the published results.

Initial sampling uses temperature 1.0 for Gemma,
Granite, and Context-1; 0.7 for Qwen; top-p 0.95. These are explicitly recorded
model configurations, not a comparison at identical temperatures. The existing
Gemma 26B MTP baseline retains its draft-MTP mode; other models have it disabled.
Its comparison therefore describes a deployment configuration, not an isolated
architecture ablation.

A second profile uses temperature 0.1, matching KeepIndex's compact-model
policy, for Gemma E2B QAT, Gemma E4B QAT, and Granite 3B. It uses three new seeds
(710–712), the same evidence and prompts, and separate matrix rows. This is an
application-settings experiment; IBM specifically recommends temperature 1.0
for Granite 4.2, so the lower-temperature profile is not its recommended preset.
Neither profile exhausts each family's reasoning modes or sampling options.

## Scoring and limits

An answer passes only when it contains the required facts, cites the sources
supporting those facts, contains no invented citation IDs or specified forbidden
claims, and completes its output. Missing-evidence and conflict cases have
additional requirements. A ranking passes only when it selects the complete
relevant document set without duplicates, fabricated IDs, or distractors.
Precision, recall, and nDCG use binary relevance labels; either ordering of two
equally relevant documents receives full credit. A bare unquoted list such as
`[D2, D4]` (or a JSON array without the required `ids` object) fails the output contract but its unambiguous selected IDs still
contribute to precision/recall. This distinction was added after inspecting an
early Granite response; the summary recomputes the metrics uniformly from every
model's raw output. Unparseable responses receive zero selection metrics.
Manual inspection also caught a false negative on arithmetic written with
`GiB` after each operand; the final scorer accepts that equivalent notation
for every model. Raw answers are unchanged, and the report records a scorer
hash alongside the frozen corpus/prompt hashes. Neither correction changes
the evidence or the prompts sent to the models.

The scorer is deterministic and has regression tests for wrong citations,
missing facts, distractor selection, duplicates, and malformed abstentions.
It does not establish semantic truth for arbitrary extra prose. Automated
failures can also reflect phrasing or output-contract differences. Review the
raw answers when interpreting a result, particularly before recommending a
default. Passing this small suite is not a guarantee of hallucination-free
behavior on other questions. Two repeats do not provide a strong confidence
interval or establish statistical significance.

Latency includes prompt processing and generation over the public API. Time
to first content excludes any private reasoning output. Backend token rates
use runtime-reported generation timings when available. Switch/load time
includes unloading the preceding model; it is separate from warm inference.
Output lengths vary, so tokens/second and end-to-end time answer different
performance questions. Errors and truncations count as failures.

Qwen 3.8 27B's initial run was stopped after the long-pack request and the next
short selection request each exceeded the configured 90-second deadline. Its
worker still appeared alive in Lemonade health. The nine recorded trials are
retained, and the row is explicitly marked `stalled`; uncompleted trials are
not invented as successes or failures. The runner now stops a model after two
consecutive timeouts. Compare that partial row's timings cautiously.

## Context-1's role

[Chroma's report](https://www.trychroma.com/research/context-1) and
[official model card](https://huggingface.co/chromadb/context-1) describe a
20B GPT-OSS fine-tune for agentic retrieval. It decomposes queries, searches,
and edits its context, returning supporting documents to a separate answering
model. The official card says its agent harness is not public. The GGUF used
here is a community conversion, identified explicitly in the manifest.

The document-selection cases provide a limited compatibility and task-transfer
check. They do **not** measure the trained multi-turn search/pruning workflow or
reproduce the paper's retrieval and speed claims. Answer-synthesis results for
Context-1 describe an out-of-role experiment, not its intended performance.

## Manual inspection examples

The long-pack stress case contains 47 documents, including repeated distractor
text. The only approved Kestrel policy says **37 days** and **mandatory
encryption**. Gemma E2B QAT instead answered “9 days” and “Encryption is optional”
while citing `[L1]`. That is an incorrect answer with a valid-looking citation,
not a formatting failure. Gemma E4B QAT and Context-1 also missed that evidence,
often reporting that the policy was unknown. This deliberately repetitive pack
does not measure an advertised maximum context window or typical search traffic.

Other automated failures have a different meaning. Granite 3B frequently selected
the correct document IDs but returned a list instead of the requested JSON
object. Qwen 4B correctly attributed the two conflicting policies using citations
before their facts, which fails the specified citation placement. Gemma E2B's
annotated subtraction and E4B's LaTeX subtraction also show why a narrow regex
grader is not a complete semantic evaluator. The raw outputs remain available
for review; do not treat the strict pass rate as an absolute accuracy score.

These results support improving candidate selection, freshness, and evidence
packing independently of model size. They do not establish that a new search
backend or a larger answering model automatically fixes those stages.

## End-to-end smoke checks

These checks use the application and current sources, separately from the frozen
model comparison. They are single observations during release validation, with
other CPU activity uncontrolled, not a controlled latency comparison or latency
distributions.

| Query | Model | Semantic option | Time | Observed result |
| --- | --- | --- | ---: | --- |
| latest on clio-coder release and features | Gemma E4B QAT | false | 5.97 s | Cited v0.4.7 and September 11 publication; concrete features checked against the live GitHub release |
| latest on clio-coder release and features | Gemma 26B A4B MTP | true | 9.55 s | Strong citation status; release facts matched the current primary record |
| How does KeepIndex select a local AI endpoint and model? | Gemma E4B QAT | false | 8.86 s | Citation status was strong, but manual review found that model selection was conflated with endpoint selection |
| How does KeepIndex select a local AI endpoint and model? | Gemma 26B A4B MTP | true | 14.06 s | Evidence checks rejected unsupported code identifiers; the draft was withheld |

The primary release record was
[iowarp/clio-coder v0.4.7](https://github.com/iowarp/clio-coder/releases/tag/v0.4.7),
published `2026-09-11T01:25:03Z`. The local-only question was run after refreshing
the previously stale projects resource. Its outcomes are deliberately retained:
neither a valid citation nor a selected model establishes complete semantic
correctness. A prompt-placement experiment did not fix that answer and was not
retained. Private application source packs stay outside the published artifacts.

The post-refresh container stall and recovery are recorded separately in
[the performance baseline](../../performance-baseline.md#september-11-source-refresh-observation).
The active application model remains the existing Gemma 26B MTP. Benchmark
loads use transient 16K/one-slot settings; they do not rewrite Lemonade's saved
per-model options or promise identical behavior after a runtime restart.

## Reproduction

Install the manifest's exact model files through Lemonade and confirm they are
advertised under the recorded IDs. The runner uses a local endpoint only,
does not download or delete models, and never falls back to a different model.
It unloads resident models during the comparison, so run it when inference is
idle. Restore your preferred model through Lemonade afterwards.

```bash
bun run bench:models --manifest docs/benchmarks/2026-09-11/models.json \
  --repeats 2 --output /tmp/keepindex-model-results.json

# A selected model or an additional set of seeds:
bun run bench:models --models Granite-4.2-3B-Q4_K_M \
  --repeats 3 --seed-offset 10 --output /tmp/granite-confirmation.json

# Recompute scores uniformly and export Markdown, CSV, and JSON:
bun run bench:report /tmp/keepindex-model-results.json \
  --output-dir /tmp/keepindex-model-summary

# Recreate the published matrix from its bundled raw answers:
bun run bench:report docs/benchmarks/2026-09-11/scored-results.json \
  --output-dir /tmp/keepindex-published-matrix
```

Measure end-to-end KeepIndex retrieval separately: this frozen-evidence test
holds retrieval constant to isolate model behavior. Changing the search engine
or the corpus while comparing models would mix retrieval errors with inference
errors and make the comparison difficult to interpret.
