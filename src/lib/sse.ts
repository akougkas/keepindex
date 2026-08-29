export type JsonSseEvent<Type extends string = string, Data = unknown> = {
  type: Type
  data?: Data
  requestId?: string
}

export type SseParseDiagnostic = {
  line: string
  error: unknown
}

export type ReadJsonSseOptions<Event extends JsonSseEvent> = {
  signal?: AbortSignal
  shouldContinue?: () => boolean
  onEvent: (event: Event) => boolean | void | Promise<boolean | void>
  onParseError?: (diagnostic: SseParseDiagnostic) => void
}

export type ReadJsonSseResult = 'completed' | 'cancelled'

function defaultParseDiagnostic({ line, error }: SseParseDiagnostic): void {
  console.warn('Ignoring malformed server-sent event.', { line, error })
}

/**
 * Reads KeepIndex's one-JSON-object-per-`data:` SSE protocol.
 *
 * The parser is deliberately tolerant of both complete SSE frames and the
 * single-newline form used by older tests/proxies. Transport parse failures are
 * reported, while errors thrown by `onEvent` propagate to the caller.
 */
export async function readJsonSse<Event extends JsonSseEvent>(
  stream: ReadableStream<Uint8Array>,
  options: ReadJsonSseOptions<Event>
): Promise<ReadJsonSseResult> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const reportParseError = options.onParseError ?? defaultParseDiagnostic
  let buffer = ''

  const canContinue = (): boolean =>
    !options.signal?.aborted && (options.shouldContinue?.() ?? true)

  const processLine = async (rawLine: string): Promise<boolean> => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.startsWith('data:')) return true

    const data = line.slice(5).trimStart()
    if (!data || data === '[DONE]') return true

    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch (error) {
      reportParseError({ line, error })
      return true
    }

    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      reportParseError({ line, error: new TypeError('SSE payload must contain a string type.') })
      return true
    }

    return (await options.onEvent(parsed as Event)) !== false
  }

  try {
    while (true) {
      if (!canContinue()) {
        await reader.cancel()
        return 'cancelled'
      }

      const { done, value } = await reader.read()
      if (done) break
      if (!canContinue()) {
        await reader.cancel()
        return 'cancelled'
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!(await processLine(line))) {
          await reader.cancel()
          return 'cancelled'
        }
      }
    }

    buffer += decoder.decode()
    if (buffer && !(await processLine(buffer))) return 'cancelled'
    return 'completed'
  } finally {
    reader.releaseLock()
  }
}
