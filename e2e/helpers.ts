import type { Page } from '@playwright/test'

/** Build SSE event-stream body from event objects. */
export function buildSSEBody(events: Array<{ type: string; data?: unknown; requestId?: string }>): string {
  return events
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join('')
}

/** Wait for text to appear on the page. */
export async function waitForText(page: Page, text: string, timeout = 15_000): Promise<void> {
  await page.getByText(text, { exact: false }).waitFor({ state: 'visible', timeout })
}

/** Set up all API route intercepts for search-flow tests. */
export async function mockAllApis(page: Page): Promise<void> {
  await page.route('**/api/search*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { title: 'Mock Result', url: 'https://example.com', snippet: 'Test snippet' },
        ],
      }),
    })
  })

  await page.route('**/api/ask', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = buildSSEBody([
      { type: 'sources', data: { web: [], local: [] } },
      { type: 'delta', data: 'Mock AI answer with enough grounded detail to support useful follow-up questions across the unified result stream.' },
      { type: 'done' },
    ])
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body,
    })
  })

  await page.route('**/api/related', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        questions: ['Follow-up 1?', 'Follow-up 2?'],
      }),
    })
  })

  await page.route('**/api/research', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = buildSSEBody([
      { type: 'thinking_delta', data: 'Planning carefully…' },
      { type: 'plan', data: { subQuestions: ['What is verified?', 'What remains open?'] } },
      { type: 'searching', data: { question: 'What is verified?', index: 0 } },
      { type: 'reading', data: { question: 'What is verified?', webSources: 1, localSources: 0 } },
      { type: 'analyzing', data: { webSources: 1, localSources: 0 } },
      { type: 'analysis', data: { summary: 'Evidence checked.', gaps: [] } },
      { type: 'sources', data: { web: [{ title: 'Research Source', url: 'https://example.com/research', snippet: 'Evidence' }], local: [] } },
      { type: 'synthesizing', data: { webSources: 1, localSources: 0 } },
      { type: 'delta', data: '# Executive Summary\n\nMock research report [1]' },
      { type: 'done', data: { totalSources: 1 } },
    ])
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body,
    })
  })

  await page.route('**/api/takeaways', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        takeaways: ['Key point 1'],
      }),
    })
  })

  await page.route('**/api/chat/conversation', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = buildSSEBody([
      { type: 'delta', data: 'Chat reply' },
      { type: 'done' },
    ])
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body,
    })
  })

  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok', healthScore: 100, llm: true, searxng: true, database: true,
        activeModel: 'local-reasoning-model', modelCount: 3,
        knowledge: { resources: 0, unavailable: 0, score: 100 },
        latencyMs: { llm: 12, searxng: 8 }, slots: { total: 4, idle: 4 }, timestamp: new Date().toISOString(),
      }),
    })
  })

  await page.route('**/api/models*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        activeModel: 'local-reasoning-model',
        configuredDefault: 'local-reasoning-model',
        configuredFallback: 'local-fallback-model',
        models: [
          { id: 'local-reasoning-model', aliases: ['Local reasoning model'], tags: ['reasoning:on'], isReasoning: true },
          { id: 'local-fallback-model', aliases: ['Local fallback model'], tags: ['reasoning:on'], isReasoning: true },
          { id: 'local-multimodal-model', aliases: ['Local multimodal model'], tags: ['vision'], isReasoning: false },
        ],
      }),
    })
  })

  await page.route('**/api/history*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ history: [] }) })
  })

  await page.route('**/api/session*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: null, saved: true }) })
  })

  await page.route('**/api/collections*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], saved: true }) })
  })

  await page.route('**/api/knowledge/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        indexed: false,
        chunkCount: 0,
        fileCount: 0,
        path: null,
      }),
    })
  })
}
