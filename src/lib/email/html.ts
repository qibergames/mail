type InlineAttachment = { id: string; contentId: string | null }

export function resolveInlineImages(html: string, messageId: string, attachments: Array<InlineAttachment>) {
  return attachments.reduce((resolved, attachment) => {
    const contentId = attachment.contentId?.replace(/^<|>$/g, '')
    return contentId
      ? resolved.replaceAll(`cid:${contentId}`, `/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}?preview=1`)
      : resolved
  }, html)
}
