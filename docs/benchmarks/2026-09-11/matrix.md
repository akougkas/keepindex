# Measured model matrix

Answer pass is a strict composite of required facts, supporting citations, abstention/conflict handling, output limits, and successful completion. It is not a general accuracy percentage. Selection pass requires the exact relevant-document set and valid JSON. Read the methodology and raw outputs before choosing a model.

| Model | Status | Temp | Weights GiB | Answer passes | Required facts | Cited facts (strict) | Selection passes | Answer p50 / p95 (s) | First content p50 (s) | Generation tok/s p50 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Granite-4.2-3B-Q4_K_M | tested | 1 | 2.09 | 5/16 | 76.8% | 30.4% | 1/8 | 2.07 / 26.42 | 0.23 | 57.4 |
| Granite-4.2-8B-Q4_K_M | tested | 1 | 4.98 | 8/16 | 75.0% | 53.6% | 6/8 | 3.86 / 54.32 | 0.47 | 27.3 |
| Qwen3.5-2B-Q4_K_M | tested | 0.7 | 1.19 | 5/16 | 85.7% | 57.1% | 7/8 | 1.88 / 10.04 | 0.48 | 48.4 |
| Qwen3.5-4B-Q4_K_M | tested | 0.7 | 2.55 | 12/16 | 89.3% | 75.0% | 8/8 | 2.71 / 12.64 | 0.80 | 28.8 |
| Qwen3.5-9B-Q4_K_M | tested | 0.7 | 5.29 | 11/16 | 82.1% | 67.9% | 8/8 | 3.56 / 12.02 | 0.66 | 25.7 |
| Gemma-4-E2B-QAT | tested | 1 | 2.44 | 13/16 | 85.7% | 85.7% | 7/8 | 0.66 / 3.06 | 0.20 | 88.1 |
| Gemma-4-E4B-QAT | tested | 1 | 3.93 | 13/16 | 85.7% | 82.1% | 8/8 | 1.41 / 7.05 | 0.33 | 54.1 |
| Gemma-4-E4B-it-GGUF | tested | 1 | 4.64 | 10/16 | 82.1% | 71.4% | 8/8 | 1.86 / 7.34 | 0.41 | 42.6 |
| Gemma-4-26B-A4B-it-MTP-GGUF | tested | 1 | 15.78 | 14/16 | 92.9% | 85.7% | 8/8 | 1.60 / 28.58 | 0.88 | 61.0 |
| Qwen3.8-27B-GGUF | stalled | 0.7 | 16.35 | 7/8 | 85.7% | 85.7% | 0/1 | 5.87 / 93.67 | 1.96 | 9.1 |
| Context-1-20B-Q4_K_M | tested | 1 | 14.72 | 12/16 | 92.9% | 78.6% | 8/8 | 4.11 / 15.02 | 2.88 | 54.1 |
| Granite-4.2-3B-Q4_K_M | tested | 0.1 | 2.09 | 8/24 | 77.4% | 51.2% | 0/12 | 2.50 / 25.75 | 0.21 | 59.7 |
| Gemma-4-E2B-QAT | tested | 0.1 | 2.44 | 18/24 | 71.4% | 71.4% | 12/12 | 0.77 / 3.05 | 0.19 | 90.9 |
| Gemma-4-E4B-QAT | tested | 0.1 | 3.93 | 15/24 | 83.3% | 78.6% | 12/12 | 1.07 / 5.85 | 0.32 | 54.2 |

Cited facts uses the specified placement of a supporting citation after the fact in the same sentence/bullet. A preceding citation can be understandable to a reader while failing this output contract. These percentages are case-macro averages, not an independent semantic audit of every claim.

| Model | Temp | Selection precision | Selection recall | nDCG | Selection p50 (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Granite-4.2-3B-Q4_K_M | 1 | 87.5% | 87.5% | 0.875 | 0.41 |
| Granite-4.2-8B-Q4_K_M | 1 | 100.0% | 100.0% | 1.000 | 0.61 |
| Qwen3.5-2B-Q4_K_M | 0.7 | 100.0% | 100.0% | 1.000 | 0.55 |
| Qwen3.5-4B-Q4_K_M | 0.7 | 100.0% | 100.0% | 1.000 | 0.67 |
| Qwen3.5-9B-Q4_K_M | 0.7 | 100.0% | 100.0% | 1.000 | 0.78 |
| Gemma-4-E2B-QAT | 1 | 87.5% | 87.5% | 0.875 | 0.24 |
| Gemma-4-E4B-QAT | 1 | 100.0% | 100.0% | 1.000 | 0.39 |
| Gemma-4-E4B-it-GGUF | 1 | 100.0% | 100.0% | 1.000 | 0.47 |
| Gemma-4-26B-A4B-it-MTP-GGUF | 1 | 100.0% | 100.0% | 1.000 | 0.93 |
| Qwen3.8-27B-GGUF | 0.7 | 0.0% | 0.0% | 0.000 | 93.72 |
| Context-1-20B-Q4_K_M | 1 | 100.0% | 100.0% | 1.000 | 3.47 |
| Granite-4.2-3B-Q4_K_M | 0.1 | 100.0% | 100.0% | 1.000 | 0.26 |
| Gemma-4-E2B-QAT | 0.1 | 100.0% | 100.0% | 1.000 | 0.23 |
| Gemma-4-E4B-QAT | 0.1 | 100.0% | 100.0% | 1.000 | 0.40 |

Context-1 is a retrieval specialist. Its answer column is an out-of-role experiment; selection is a fixed-candidate proxy, not a reproduction of its agentic retrieval harness.

Weights are GGUF file sizes, not loaded RAM/VRAM. Generation rates use backend-reported token timings. Different tokenizers, output lengths, sampling settings, and MTP modes limit comparisons of raw token rates. Load time is excluded; request errors and truncations remain failures.

Corpus SHA-256: `b77aa053391bcc030069f15a7fff73075553a804f31a4f768f3a31353f8ed4ea`
Prompt SHA-256: `929c463f5a294cbc3605c317a679207474390a8e2b26ded40331687901cb754c`

Scorer SHA-256: `1b2cc23878e1d5605bf38d47d80e97cec4d30b2aa248e306b3878823f264249f`
