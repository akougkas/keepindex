/** Public diagnostics deliberately exclude backend logs, paths, and credentials. */
export class InferenceModelLoadError extends Error {
  constructor(model: string) {
    const label = model.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240)
    const guidance = /diffusion[-_]?gemma/i.test(model)
      ? 'DiffusionGemma needs a diffusion-capable inference runtime; downloading its weights does not add backend support. '
      : ''
    super(`The selected AI endpoint could not load "${label}". No other model was used. ${guidance}Check the endpoint's model-load log or choose another model.`)
    this.name = 'InferenceModelLoadError'
  }
}

const MAX_ERROR_BYTES = 16_384

/**
 * Consume a failed HTTP response while its caller's abort/timeout is still live.
 * Model-load failures are terminal: retrying may evict working models (Lemonade
 * does this during load recovery), and model substitution hides incompatibility.
 * Unknown errors keep the existing HTTP status retry policy.
 */
export async function readModelLoadFailure(response: Response, model: string): Promise<InferenceModelLoadError | null> {
  if (response.ok || !response.body) return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_ERROR_BYTES) return null
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    // Do not wait for a non-cooperative upstream cancellation to complete.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  let code = ''
  let type = ''
  let message = text
  try {
    const payload = JSON.parse(text) as { error?: unknown }
    if (payload?.error && typeof payload.error === 'object') {
      const error = payload.error as Record<string, unknown>
      code = typeof error.code === 'string' ? error.code : ''
      type = typeof error.type === 'string' ? error.type : ''
      message = typeof error.message === 'string' ? error.message : ''
    } else if (typeof payload?.error === 'string') message = payload.error
  } catch {
    // llama.cpp and proxies can return plain-text architecture errors.
  }
  return code === 'model_load_error' || type === 'model_load_error'
    || /(?:unknown|unsupported) model architecture|failed to load model/i.test(message)
    ? new InferenceModelLoadError(model)
    : null
}
