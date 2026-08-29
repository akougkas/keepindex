import { Children, isValidElement, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { Components } from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'

type MarkdownNode = {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

/**
 * Matches a citation bracket in either form models emit: `[2]`, `[L3]`, or the
 * grouped `[2, 3, 5]`. A grouped citation becomes one pill per identifier, so
 * every source the model cited stays clickable. Padding and a dangling
 * separator are tolerated, because `[1, 2 ]` should not render as literal text.
 *
 * Kept byte-identical to CITATION_GROUP_PATTERN in server/index.ts: if the
 * renderer and the grounding scorer disagree about what a citation is, the
 * badge contradicts what the reader sees.
 */
const CITATION_PATTERN = /\[\s*(L?\d+(?:\s*[,;]\s*L?\d+)*)\s*[,;]?\s*\]/gi
const CITATION_LINK_PREFIX = '#keepindex-citation-'

/**
 * Converts citation-shaped text nodes to safe Markdown links. Raw model HTML stays
 * disabled, while the link renderer below turns only these links into buttons.
 */
export function remarkCitations() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode, blocked = false) => {
      const nextBlocked = blocked || node.type === 'link' || node.type === 'linkReference' || node.type === 'code' || node.type === 'inlineCode'
      if (!node.children || nextBlocked) return

      const nextChildren: MarkdownNode[] = []
      for (const child of node.children) {
        if (child.type !== 'text' || typeof child.value !== 'string') {
          visit(child, nextBlocked)
          nextChildren.push(child)
          continue
        }

        let cursor = 0
        CITATION_PATTERN.lastIndex = 0
        for (const match of child.value.matchAll(CITATION_PATTERN)) {
          const index = match.index ?? 0
          if (index > cursor) nextChildren.push({ type: 'text', value: child.value.slice(cursor, index) })
          const identifiers = match[1]
            .split(/[,;]/)
            .map((identifier) => identifier.trim().toUpperCase())
            .filter(Boolean)
          identifiers.forEach((citation, position) => {
            if (position > 0) nextChildren.push({ type: 'text', value: ' ' })
            nextChildren.push({
              type: 'link',
              url: `${CITATION_LINK_PREFIX}${citation}`,
              children: [{ type: 'text', value: `[${citation}]` }],
            })
          })
          cursor = index + match[0].length
        }
        if (cursor === 0) nextChildren.push(child)
        else if (cursor < child.value.length) nextChildren.push({ type: 'text', value: child.value.slice(cursor) })
      }
      node.children = nextChildren
    }

    visit(tree)
  }
}

type CodeElementProps = {
  className?: string
  children?: ReactNode
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (isValidElement<CodeElementProps>(node)) return textContent(node.props.children)
  return ''
}

/**
 * Fenced code is represented structurally as `pre > code` by react-markdown.
 * react-markdown v10 no longer passes the old `inline` flag to `code`, so the
 * `pre` renderer is the reliable place to distinguish blocks from inline code.
 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const codeElement = Children.toArray(children).find((child) =>
    isValidElement<CodeElementProps>(child)
  )
  const className = codeElement?.props.className
  const match = /language-(\w+)/.exec(className ?? '')
  const code = textContent(codeElement?.props.children ?? children).replace(/\n$/, '')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-border/70 bg-[oklch(0.13_0.015_255)] text-[oklch(0.92_0.01_250)] shadow-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-white/55">{match?.[1] ?? 'code'}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          aria-label="Copy code"
          className="size-6 text-white/60 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="size-3 text-[oklch(0.78_0.18_145)]" /> : <Copy className="size-3" />}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed"><code className="font-mono">{code}</code></pre>
    </div>
  )
}

export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-bold mt-6 mb-3 first:mt-0 text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold mt-5 mb-2 border-l-2 border-primary pl-3 text-foreground">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold mt-4 mb-2 text-foreground">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold mt-4 mb-2 text-foreground">{children}</h4>
  ),
  p: ({ children }) => <p className="text-base leading-relaxed mb-3">{children}</p>,
  ul: ({ children }) => (
    <ul className="pl-6 space-y-1.5 mb-3 list-none [&>li]:relative [&>li]:pl-4 [&>li]:before:content-[''] [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-2 [&>li]:before:size-1.5 [&>li]:before:rounded-full [&>li]:before:bg-primary">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="pl-6 space-y-1.5 mb-3 list-decimal [&>li]:font-mono [&>li]:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="text-base leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/40 bg-muted/30 italic pl-4 py-2 my-3 rounded-r-lg">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => {
    if (href?.startsWith(CITATION_LINK_PREFIX)) {
      const citation = href.slice(CITATION_LINK_PREFIX.length)
      const isLocal = citation.startsWith('L')
      return (
        <button
          type="button"
          className={isLocal ? 'citation-pill citation-pill-local' : 'citation-pill'}
          data-citation={citation}
          aria-label={`Open ${isLocal ? 'local' : 'web'} source ${citation.replace(/^L/, '')}`}
        >
          {children}
        </button>
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline decoration-primary/30 hover:decoration-primary transition"
      >
        {children}
      </a>
    )
  },
  code: ({ className, children }) => (
    <code className={['font-mono text-sm bg-muted/50 px-1.5 py-0.5 rounded-md', className].filter(Boolean).join(' ')}>
      {children}
    </code>
  ),
  pre: CodeBlock,
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full border-collapse [&_tbody_tr:nth-child(even)]:bg-muted/20">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead>
      <tr className="border-b border-border/50">{children}</tr>
    </thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border/50">{children}</tr>,
  th: ({ children }) => (
    <th className="bg-muted/50 font-medium px-4 py-2 text-left text-sm">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-2 text-sm border-b border-border/50">{children}</td>
  ),
}
