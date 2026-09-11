import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  markdownComponents,
  remarkCitations,
} from './markdown-components'

function renderMarkdown(source: string) {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkCitations],
      components: markdownComponents,
      children: source,
    })
  )
}

describe('markdownComponents code rendering', () => {
  it('keeps inline code inside its paragraph without a block toolbar', () => {
    const markup = renderMarkdown('Use `bun test` now.')

    expect(markup).toContain(
      '<p class="text-base leading-relaxed mb-3">Use <code'
    )
    expect(markup).toContain('>bun test</code> now.</p>')
    expect(markup).not.toContain('<pre')
    expect(markup).not.toContain('aria-label="Copy code"')
  })

  it('renders an unlabelled fence as a block with copy controls', () => {
    const markup = renderMarkdown('```\nconst answer = 42\n```')

    expect(markup).toContain('>code</span>')
    expect(markup).toContain('aria-label="Copy code"')
    expect(markup).toContain(
      '<pre class="overflow-x-auto p-4 text-sm leading-relaxed"><code class="font-mono">const answer = 42</code></pre>'
    )
  })

  it('shows the language for a labelled fence', () => {
    const markup = renderMarkdown('```ts\nconst answer: number = 42\n```')

    expect(markup).toContain('>ts</span>')
    expect(markup).toContain(
      '<code class="font-mono">const answer: number = 42</code>'
    )
  })

  it('does not turn citation-shaped code into citation controls', () => {
    const markup = renderMarkdown(
      'Cited [2]. Inline `value [3]`.\n\n```\nblock [L4]\n```'
    )

    expect(markup).toContain('data-citation="2"')
    expect(markup).not.toContain('data-citation="3"')
    expect(markup).not.toContain('data-citation="L4"')
    expect(markup).toContain('value [3]</code>')
    expect(markup).toContain('<code class="font-mono">block [L4]</code>')
  })

  it('propagates the leading L namespace across grouped local citations', () => {
    const markup = renderMarkdown('Local evidence proves this [L1, 2; 3, 4].')

    expect(markup).toContain('data-citation="L1"')
    expect(markup).toContain('data-citation="L2"')
    expect(markup).toContain('data-citation="3"')
    expect(markup).toContain('data-citation="4"')
  })
})
