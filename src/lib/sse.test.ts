import { describe, expect, it } from 'bun:test'
import { readJsonSse, type JsonSseEvent, type SseParseDiagnostic } from './sse'

function byteStream(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk))
      controller.close()
    },
  })
}

describe('readJsonSse', () => {
  it('handles fragmented bytes, CRLF, multiple frames, and an unterminated final line', async () => {
    const encoder = new TextEncoder()
    const unicodeFrame = encoder.encode('data: {"type":"delta","data":"café"}\r\n')
    const splitAt = unicodeFrame.indexOf(0xc3) + 1
    const events: JsonSseEvent[] = []

    const result = await readJsonSse(
      byteStream([
        'event: message\r\n',
        'data: {"type":"delta",',
        '"data":"first"}\r\n\r\n: heartbeat\r\n',
        unicodeFrame.slice(0, splitAt),
        unicodeFrame.slice(splitAt),
        'data: {"type":"done"}',
      ]),
      { onEvent: (event) => { events.push(event) } }
    )

    expect(result).toBe('completed')
    expect(events).toEqual([
      { type: 'delta', data: 'first' },
      { type: 'delta', data: 'café' },
      { type: 'done' },
    ])
  })

  it('reports malformed payloads and continues with later events', async () => {
    const diagnostics: SseParseDiagnostic[] = []
    const events: JsonSseEvent[] = []

    await readJsonSse(
      byteStream([
        'data: {not-json}\n',
        'data: {"data":"missing type"}\n',
        'data: {"type":"delta","data":"kept"}\n',
      ]),
      {
        onParseError: (diagnostic) => diagnostics.push(diagnostic),
        onEvent: (event) => { events.push(event) },
      }
    )

    expect(diagnostics).toHaveLength(2)
    expect(events).toEqual([{ type: 'delta', data: 'kept' }])
  })

  it('does not swallow errors thrown by the event handler', async () => {
    await expect(
      readJsonSse(byteStream(['data: {"type":"delta"}\n']), {
        onEvent: () => { throw new Error('handler failed') },
      })
    ).rejects.toThrow('handler failed')
  })
})
