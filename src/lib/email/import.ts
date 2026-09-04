import { and, eq } from 'drizzle-orm'
import PostalMime from 'postal-mime'
import { getDb } from '@/db'
import { domains, mailboxes, messages } from '@/db/schema'
import { newId } from '@/lib/ids'
import { removeMessages } from './sync'
import { storeAttachments } from './attachments'
import { accessibleMailboxIds } from './outbound'

export type RawEmail = { name: string; content: ArrayBuffer }
export type ImportResult = { ids: Array<string>; skipped: number; errors: Array<string> }

export async function importRawEmails(env: CloudflareEnv, userId: string, mailboxId: string, files: Array<RawEmail>) {
  if (!(await accessibleMailboxIds(userId)).includes(mailboxId)) throw new Error('Invalid mailbox')
  const db = getDb(env.DB)
  const mailbox = (await db.select({ box: mailboxes, hostname: domains.hostname }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxes.id, mailboxId)).limit(1)).at(0)!
  const result: ImportResult = { ids: [], skipped: 0, errors: [] }
  for (const file of files) {
    let rawR2Key: string | undefined
    try {
      const email = await PostalMime.parse(file.content); const id = newId('msg'); rawR2Key = `imports/${id}/${file.name.replace(/[/\\\0]/g, '_')}`
      const providerMessageId = email.messageId ?? `import:${file.name}:${file.content.byteLength}`
      if ((await db.select({ id: messages.id }).from(messages).where(and(eq(messages.mailboxId, mailboxId), eq(messages.providerMessageId, providerMessageId))).limit(1)).length) { result.skipped++; continue }
      await env.BUCKET.put(rawR2Key, file.content, { httpMetadata: { contentType: 'message/rfc822' } })
      const from = email.from && 'address' in email.from ? email.from.address ?? '' : ''
      const to = email.to?.flatMap((entry) => 'address' in entry && entry.address ? [entry.address] : []).join(', ') || `${mailbox.box.localPart}@${mailbox.hostname}`
      await db.insert(messages).values({ id, userId: mailbox.box.userId, mailboxId: mailbox.box.id, direction: 'inbound', providerMessageId, fromAddr: from, toAddr: to, subject: email.subject, snippet: (email.text ?? '').replace(/\s+/g, ' ').slice(0, 200), textBody: email.text ?? null, htmlBody: email.html ?? null, rawR2Key, status: 'received', read: true, createdAt: email.date ? new Date(email.date) : new Date() })
      await storeAttachments(env, id, email.attachments.map((attachment, index) => ({ filename: attachment.filename ?? `attachment-${index + 1}`, type: attachment.mimeType || 'application/octet-stream', content: typeof attachment.content === 'string' ? new TextEncoder().encode(attachment.content).buffer : attachment.content instanceof ArrayBuffer ? attachment.content : attachment.content.buffer.slice(attachment.content.byteOffset, attachment.content.byteOffset + attachment.content.byteLength) as ArrayBuffer, disposition: attachment.disposition === 'inline' ? 'inline' as const : 'attachment' as const, contentId: attachment.contentId })))
      result.ids.push(id)
    } catch (error) {
      if (rawR2Key) await Promise.all([removeMessages(db, eq(messages.rawR2Key, rawR2Key)), env.BUCKET.delete(rawR2Key)])
      result.skipped++
      result.errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Import failed'}`)
    }
  }
  return result
}
