import { eq } from 'drizzle-orm'
import PostalMime from 'postal-mime'
import { getDb } from '@/db'
import { domains, mailboxes, messages } from '@/db/schema'
import { newId } from '@/lib/ids'
import { storeAttachments } from './attachments'
import { accessibleMailboxIds } from './outbound'

export type RawEmail = { name: string; content: ArrayBuffer }

export async function importRawEmails(env: CloudflareEnv, userId: string, mailboxId: string, files: Array<RawEmail>) {
  if (!(await accessibleMailboxIds(userId)).includes(mailboxId)) throw new Error('Invalid mailbox')
  const mailbox = (await getDb(env.DB).select({ box: mailboxes, hostname: domains.hostname }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxes.id, mailboxId)).limit(1)).at(0)!
  const ids: Array<string> = []
  for (const file of files) {
    const email = await PostalMime.parse(file.content); const id = newId('msg'); const rawR2Key = `imports/${id}/${file.name.replace(/[/\\\0]/g, '_')}`
    await env.BUCKET.put(rawR2Key, file.content, { httpMetadata: { contentType: 'message/rfc822' } })
    const from = email.from && 'address' in email.from ? email.from.address ?? '' : ''
    const to = email.to?.flatMap((entry) => 'address' in entry && entry.address ? [entry.address] : []).join(', ') || `${mailbox.box.localPart}@${mailbox.hostname}`
    try {
      await getDb(env.DB).insert(messages).values({ id, userId: mailbox.box.userId, mailboxId: mailbox.box.id, direction: 'inbound', providerMessageId: email.messageId, fromAddr: from, toAddr: to, subject: email.subject, snippet: (email.text ?? '').replace(/\s+/g, ' ').slice(0, 200), textBody: email.text ?? null, htmlBody: email.html ?? null, rawR2Key, status: 'received', read: true, createdAt: email.date ? new Date(email.date) : new Date() })
      await storeAttachments(env, id, email.attachments.map((attachment, index) => ({ filename: attachment.filename ?? `attachment-${index + 1}`, type: attachment.mimeType || 'application/octet-stream', content: typeof attachment.content === 'string' ? new TextEncoder().encode(attachment.content).buffer : attachment.content instanceof ArrayBuffer ? attachment.content : attachment.content.buffer.slice(attachment.content.byteOffset, attachment.content.byteOffset + attachment.content.byteLength) as ArrayBuffer, disposition: attachment.disposition === 'inline' ? 'inline' as const : 'attachment' as const, contentId: attachment.contentId })))
      ids.push(id)
    } catch (error) {
      await Promise.all([getDb(env.DB).delete(messages).where(eq(messages.id, id)), env.BUCKET.delete(rawR2Key)])
      throw error
    }
  }
  return ids
}
