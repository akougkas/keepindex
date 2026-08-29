export function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30)
}

export function buildChatMarkdown(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): { markdown: string; topic: string } {
  const firstUserMessage = messages.find((m) => m.role === 'user')?.content?.trim() || 'Untitled chat'
  const title = firstUserMessage.replace(/\s+/g, ' ').slice(0, 120)
  const body = messages
    .map((message) => `**${message.role === 'user' ? 'User' : 'Assistant'}:** ${message.content}`)
    .join('\n\n')
  return {
    markdown: `# Chat: ${title}\n\n${body}\n`,
    topic: firstUserMessage,
  }
}
