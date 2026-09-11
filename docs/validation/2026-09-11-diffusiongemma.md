# DiffusionGemma inference investigation — September 11, 2026

## Runtime result

ZBook's installed Lemonade 11.9.0 advertises the downloaded model
`diffusiongemma-26B-A4B-it-GGUF-Q4_K_M` using the `llamacpp` recipe.
Its installed ROCm backend is b10711. Listing this model does not establish
that the runtime can execute it.

- Direct public Lemonade API completion: HTTP 500, `model_load_error`,
  `llama-server failed to start`, 9.68 seconds.
- Bundled ROCm `llama-diffusion-cli`, using the existing downloaded GGUF:
  exit 1, `unknown model architecture: 'diffusion-gemma'`, 0.63 seconds.
- Lemonade 11.9.0 was the latest published Lemonade release when checked.
  The upstream diffusion implementations and Lemonade support request remain
  open; see [inference compatibility notes](../LOCAL-INFERENCE.md#diffusiongemma-compatibility).

No working DiffusionGemma inference is claimed. This is a runtime architecture
limitation, not missing weights or a KeepIndex authentication issue. Existing
Lemonade backend binaries and model registrations were preserved.

## KeepIndex repair

Model-load and architecture failures stop the inference call immediately,
before KeepIndex's ordinary HTTP retries or configured model fallback.
Chat and answer streams report a useful model-specific error. Failed query
records retain a null actual model rather than claiming successful generation.
Backend paths, logs, and credentials are excluded from the public diagnostic.
Compatible diffusion endpoints remain usable; the model name is not blocked.

## Deployed checks

The ZBook Docker application was rebuilt and restarted.

| Check | Result |
| --- | --- |
| Tests | 640 pass, 0 fail, 50 files |
| Production build, including `tsc -b` | Pass |
| `keepidx doctor` | `Result: ready` |
| KeepIndex and SearXNG containers | Healthy |
| `/api/health` | `healthScore: 100`, `searxng: true`, `llm: true` |
| DiffusionGemma through `/api/chat/conversation` | Clear load error in 3.22 seconds; no answer, metrics, or done event |
| Existing `Gemma-4-E4B-it-GGUF`, subsequent chat | `local inference ready`, 6.48 seconds, metrics and done events |

API health checks endpoint reachability; it does not certify that every model
in an endpoint's catalog can load. The DiffusionGemma and ordinary Gemma probes
used explicit request models without changing the user's saved model selection.

The pre-rebuild KeepIndex process was unresponsive and its container health
checks timed out. Restarting restored responsiveness. That separate process
stall was not established to be caused by DiffusionGemma, and this change does
not claim to diagnose or repair its underlying cause.
