type InlineAttachment = { id: string; contentId: string | null }

export function resolveInlineImages(html: string, messageId: string, attachments: Array<InlineAttachment>) {
  return attachments.reduce((resolved, attachment) => {
    const contentId = attachment.contentId?.replace(/^<|>$/g, '')
    return contentId
      ? resolved.replaceAll(`cid:${contentId}`, `/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}?preview=1`)
      : resolved
  }, html)
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', zwnj: '', zwj: '', shy: '' }

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? entity
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

/** Plain text of an HTML body, for snippets and rule matching. */
export function textFromHtml(html?: string | null) {
  const text = (html ?? '').replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  return decodeEntities(text).replace(/\s+/g, ' ').trim()
}

/**
 * Readable plain text of a message. Some senders put HTML entities in the text part too, and newsletters pad
 * the preheader with invisible joiners, so both are cleaned up.
 */
export function readableText(text?: string | null, html?: string | null) {
  const source = text?.trim() ? decodeEntities(text) : textFromHtml(html)
  return source.replace(/\u034f|[\u00ad\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim()
}

/** The one-line preview shown in the message list. */
export function snippetFrom(text?: string | null, html?: string | null) {
  return readableText(text, html).slice(0, 200)
}
