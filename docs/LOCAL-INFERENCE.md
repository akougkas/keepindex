# Local inference providers

KeepIndex sends prompts and bounded evidence packs only to inference servers inside a user-controlled local network boundary. Authenticated private gateways can use a Bearer token. It has no public model-provider adapter, cloud fallback, or credential-bearing inference URL.

## Provider selection

```bash
KEEPINDEX_INFERENCE_PROVIDER=auto
LLM_URL=http://127.0.0.1:8080
```

The provider selector accepts:

- `auto` — try the local OpenAI-compatible discovery endpoint, then bounded native Ollama discovery;
- `openai-compatible` — use `/v1/models` and `/v1/chat/completions` only;
- `ollama` — use native `/api/tags` and `/api/chat` only.

Auto-detection pins the working transport after discovery. It does not probe a public registry or download a model.

For an authenticated private gateway, set `LLM_API_KEY` in your untracked `.env` file alongside `LLM_URL`. Compose forwards this variable to the application. Native KeepIndex and `keepidx doctor` use the same variable. Copy the gateway's token value into `LLM_API_KEY`; provider-specific variables such as `LITELLM_API_KEY` are not read by KeepIndex. Leave the value empty for an unauthenticated local server.

The token is sent only to the configured inference endpoint for model discovery, completions, embeddings, and optional slot checks. The endpoint policy below still applies. Configure the gateway itself to route the selected models to runtimes within your intended private boundary.

## Supported local engines

| Runtime | Transport | Configure |
| --- | --- | --- |
| llama.cpp / `llama-server` | OpenAI-compatible | Local server root, commonly `http://127.0.0.1:8080` |
| vLLM | OpenAI-compatible | Local server root; do not append `/v1` to `LLM_URL` |
| SGLang | OpenAI-compatible | Local server root |
| LM Studio | OpenAI-compatible | Enable the local server and use its root URL |
| Lemonade Server | OpenAI-compatible | Use the root of its locally exposed compatible service |
| MLX-LM or another MLX-compatible server | OpenAI-compatible | Use the local compatible service root |
| Ollama | Native or OpenAI-compatible | Prefer `KEEPINDEX_INFERENCE_PROVIDER=ollama` with the Ollama service root |
| NVIDIA Triton | Compatible frontend/ensemble | Put a local OpenAI-compatible chat frontend in front of the model repository |

The OpenAI-compatible label names a request/response format. It never routes through OpenAI.

Arbitrary Triton models expose model-specific tensor names, shapes, dtypes, decoders, and streaming behavior. KeepIndex cannot honestly infer that contract. A Triton deployment is supported when the owner exposes a compatible chat frontend or a stable ensemble that implements the documented compatible protocol.

## Model discovery and selection

When `LLM_MODEL` is empty, KeepIndex selects the first model advertised by the local server. The UI shows the full advertised catalog. A request may select another advertised identifier, and every answer/query record reports the model actually used.

```bash
LLM_MODEL=
LLM_FALLBACK_MODEL=
```

Set these only to identifiers the active local server advertises. KeepIndex ships no hardcoded production model.

The model selector also accepts an identifier without its gateway route prefix (for example, `model-name` for `gateway/model-name`). An exact advertised identifier always wins. Use the full identifier when several routes advertise the same model, and for `LLM_MODEL` and `LLM_FALLBACK_MODEL`.

Native Ollama results are normalized into the same internal catalog and completion shapes as compatible providers. Native streaming keeps answer content, finish reason, token counts, and timing data while deliberately discarding private reasoning fields. A malformed or incomplete stream still reaches the existing fail-closed terminal-frame checks.

## Endpoint policy

Allowed address forms include:

- `localhost`, `127.0.0.0/8`, and IPv6 loopback;
- RFC1918 IPv4;
- Tailscale's shared `100.64.0.0/10` address range (without trusting arbitrary
  public `.ts.net` names);
- IPv6 unique-local and link-local addresses;
- single-label container or homelab service names;
- `host.docker.internal`;
- names ending in `.localhost`, `.local`, `.lan`, `.internal`, or `.home.arpa`.

KeepIndex rejects:

- public IP addresses and public DNS names;
- OpenAI, Anthropic, and Google cloud host families explicitly;
- URL usernames/passwords, query strings, and fragments;
- non-HTTP(S) protocols;
- redirects, including a redirect from an allowed local server to a public host.

The rejection error never echoes the configured URL, so accidental credential material is not copied into logs.

This is a DNS-free allow policy. A public hostname that happens to resolve to a private address is still rejected because DNS can change after validation. Use a stable local name or private address.

## Docker connectivity

The Compose stack supplies:

```text
LLM_URL=http://host.docker.internal:8080
```

Docker maps that name to the host gateway. The model server must listen on an interface reachable from Docker, and the host firewall should restrict that listener. KeepIndex itself remains published on host loopback by default.

To use a model runtime in the same Compose network, add it through an explicit override and set `LLM_URL` to its single-label service name, for example `http://inference:8080`. Do not expose its port publicly unless another local client needs it.

## Failure behavior

- Missing local model server: web and local search remain available; answer/research features report degraded local inference.
- Empty model catalog: no model identifier is invented.
- Configured model unavailable: KeepIndex may try the configured local fallback but records the actual model used.
- Provider timeout or incomplete stream: the query record is failed/interrupted rather than marked successful.
- Reasoning-only response: one bounded retry may disable thinking; private reasoning is not exposed as answer text.
- No evidence: KeepIndex refuses factual synthesis even when the local model is healthy.

## Current multimodal boundary

KeepIndex accepts model identifiers and capabilities from multimodal local servers, but the first-release evidence protocol supplies bounded text. It does not yet send document images or page crops to a vision model. Rich OCR, layout, figure, and multimodal indexing are under a separate architecture review because they must preserve page coordinates, citation provenance, resource budgets, and offline/container guarantees. Do not describe a multimodal model in the catalog as proof that visual ingestion is implemented.

## Verify

```bash
keepidx doctor
keepidx status
keepidx status --json
```

`doctor` validates that the configured inference URL is private before probing it and redacts credential/query material. `status` reads the KeepIndex health endpoint and reports local provider/model availability without printing secrets.
