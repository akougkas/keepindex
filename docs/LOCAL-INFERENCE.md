# AI connections: local runtimes and remote gateways

KeepIndex runs and indexes data on your computer. AI is a separate choice: use Lemonade, LM Studio, Ollama, llama.cpp, another local runtime, Blade AI Gateway, or a configured OpenAI-compatible HTTP(S) endpoint. Local AI is the default recommendation; remote AI is supported explicitly.

## Choose an endpoint, then a model

Open **Settings → AI connections**. Select an endpoint, then select an advertised model in **Active AI model**. **Check endpoints** probes public model APIs for configured connections and standard local runtime ports. It does not scan the LAN, inspect model-cache folders, or connect to internal llama.cpp worker ports.

The initial catalog includes these local runtime connections:

| Runtime | Native base URL | Docker base URL | Transport |
| --- | --- | --- | --- |
| Lemonade | `http://127.0.0.1:13305/api` | `http://host.docker.internal:13305/api` | OpenAI-compatible |
| LM Studio | `http://127.0.0.1:1234` | `http://host.docker.internal:1234` | OpenAI-compatible |
| Ollama | `http://127.0.0.1:11434` | `http://host.docker.internal:11434` | Native Ollama |
| llama.cpp | `http://127.0.0.1:8080` | `http://host.docker.internal:8080` | OpenAI-compatible |

Start the runtime and enable its API before checking. A configured profile shown as unavailable is not a claim that its runtime is installed or running. Use **Edit selected** for a custom port; older Lemonade installations can use a different public port. KeepIndex lists the models advertised by the runtime and does not download weights automatically.

## Add Blade or any compatible endpoint

Use **Add endpoint**, enter a descriptive name, URL, protocol, and optional API key, then save. Saving does not select the endpoint. Select it from the endpoint menu when you want to use it. For an OpenAI-compatible API, both the server root and a base ending in `/v1` are accepted. A Lemonade `/api/v1` URL is normalized to the `/api` base.

For Blade, use `http://100.124.181.9:4000`, OpenAI-compatible, and the gateway's Bearer key. Its catalog includes gateway-prefixed identifiers such as `dynamo/ornith-1.5-35b-a3b`; KeepIndex preserves those exact identifiers.

A remote connection is labeled **Remote** in Settings and beside the query box. Prompts, conversation context, and retrieved evidence excerpts used for AI processing go to that selected endpoint. Original folders and the index stay on the computer, but this does not mean every piece of private content stays local when remote AI is selected. Use a local connection when the evidence must remain on this computer.

Model fallback, when configured, stays within the selected endpoint. KeepIndex never silently switches from local AI to a remote connection. Requests already running stay pinned to their original connection and credentials while you change the endpoint for later requests.

## Credentials and persistence

Connections and the selected model persist in `ai-connections.json` alongside the local database (`/data/ai-connections.json` in Docker). The file is written with owner-only permissions and is excluded from Git and image build contexts. Keys are never returned through the connection-list API or saved in browser storage. Changing an endpoint URL does not automatically transfer the previous URL's key.

Environment variables seed the initial configured connection on first startup:

```dotenv
KEEPINDEX_AI_NAME=Lemonade
LLM_URL=http://host.docker.internal:13305/api
KEEPINDEX_INFERENCE_PROVIDER=openai-compatible
LLM_MODEL=
LLM_API_KEY=
LLM_FALLBACK_MODEL=
KEEPINDEX_EMBEDDING_MODEL=
```

Once connections have been saved, edit them in Settings; the saved catalog takes precedence over these bootstrap variables. `KEEPINDEX_AI_CONNECTIONS_PATH` can override the native catalog path. Back up this credential-bearing file privately. A settings/state export does not include these keys.

Any HTTP(S) inference host can be configured explicitly, including LAN, Tailscale, and public services. Credentials inside URLs, query strings, fragments, and redirects are rejected. API keys are attached only to that connection's inference requests. Use HTTPS for remote connections unless the transport is protected separately, as with the Tailscale address above. A custom service must expose one of the supported protocols; proprietary APIs require a compatible gateway.

## Host runtime and Docker

Docker Desktop reaches host services through `host.docker.internal`. Native KeepIndex normally uses loopback directly. Linux Docker Engine may require a runtime listener restricted to its local bridge. An AI container on the same Compose network is another option. KeepIndex itself and SearXNG remain published only on loopback.

Select a model that fits your hardware. Stop or start models using the runtime's own tools. An unavailable endpoint produces an unavailable AI result; retrieval can still work without AI. Web-enabled search separately sends queries to public search engines.

## Current ZBook installation

ZBook uses Lemonade's **public API on port 13305**, with its existing model catalog. Port 8001/8002 llama.cpp workers and Hugging Face cache-file paths are implementation details of that runtime, not KeepIndex connections. Blade AI Gateway is an additional authenticated connection. LM Studio, Ollama, and standalone llama.cpp are checked at their public local APIs and may be unavailable until started. The application, sources, local index, and SearXNG stay on ZBook; Blade also hosts the separate static product website.
