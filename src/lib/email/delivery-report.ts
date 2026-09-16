import { parseAddress } from './address'

export type DeliveryFailure = { recipient: string; status: string | null; reason: string }
export type DeliveryReport = { originalMessageId: string | null; failures: Array<DeliveryFailure> }

type ParsedAttachment = { mimeType: string; content: string | ArrayBuffer | Uint8Array }
type ParsedEmail = { headers: Array<{ key: string; value: string }>; attachments: Array<ParsedAttachment> }

const decode = (content: ParsedAttachment['content']) => typeof content === 'string' ? content : new TextDecoder().decode(content)

/** RFC 3464 fields, one record per blank-line separated block, with folded lines joined. */
function statusBlocks(body: string) {
  return body.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split(/\n\s*\n/).map((block) => Object.fromEntries(block.split('\n').flatMap((line) => {
    const colon = line.indexOf(':')
    return colon > 0 ? [[line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]] : []
  })) as Record<string, string | undefined>)
}

/** Reads a standard delivery status notification; returns null for anything else, including a plain "undelivered" text. */
export function parseDeliveryReport(email: ParsedEmail): DeliveryReport | null {
  const status = email.attachments.find((attachment) => /^message\/(global-)?delivery-status$/i.test(attachment.mimeType))
  if (!status) return null
  const failures = statusBlocks(decode(status.content)).flatMap((block) => {
    const recipient = (block['final-recipient'] ?? block['original-recipient'])?.replace(/^[^;]*;\s*/, '')
    if (block.action?.toLowerCase() !== 'failed' || !recipient || !parseAddress(recipient)) return []
    const code = block.status?.match(/\d\.\d{1,3}\.\d{1,3}/)?.[0] ?? null
    const reason = block['diagnostic-code']?.replace(/^[^;]*;\s*/, '') || (code ? `Status ${code}` : 'Delivery failed')
    return [{ recipient: parseAddress(recipient)!.address, status: code, reason }]
  })
  const original = email.attachments.find((attachment) => /^(message\/(global-)?rfc822|text\/rfc822-headers)$/i.test(attachment.mimeType))
  const originalMessageId = original ? decode(original.content).match(/^message-id:\s*(<[^>\s]+>)/im)?.[1] ?? null : null
  return failures.length ? { originalMessageId, failures } : null
}

/** Email Sending lifecycle events delivered through a queue event subscription. */
export type EmailSendingEvent = {
  type: string
  payload: {
    messageId?: string
    sender?: string
    recipient?: string
    subject?: string
    delivery?: { smtpEnhancedStatusCode?: string; smtpResponse?: string }
    bounce?: { type?: 'hard' | 'soft'; reason?: string }
    failure?: { reason?: string }
    /** Rejected before delivery: a suppressed recipient, validation or spam policy. */
    rejection?: { reason?: string; detail?: string }
  }
}

export function isEmailSendingEvent(value: unknown): value is EmailSendingEvent {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' && value.type.startsWith('cf.email.sending.') && 'payload' in value
}
