import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { getDb } from '@/db'
import { contacts, domains, mailboxAccess, mailboxes, messageAttachments, messages, outboundJobs, users } from '@/db/schema'
import type { Attachment } from './attachments'
import { storeAttachments } from './attachments'
import { formatAddress, parseAddress } from './address'
import { newId } from '@/lib/ids'
import { enqueueWebhookEvent } from '@/lib/webhooks'

export type OutboundQueueMessage = {
  type: 'outbound-mail'
  jobId: string
  messageId: string
  from: string
  to: string
  subject: string
  text: string
  html?: string
}

export async function accessibleMailboxIds(userId: string) {
  const db = getDb()
  const [owned, delegated] = await Promise.all([
    db.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.userId, userId), eq(mailboxes.disabled, false))),
    db.select({ id: mailboxAccess.mailboxId }).from(mailboxAccess).innerJoin(mailboxes, eq(mailboxAccess.mailboxId, mailboxes.id)).where(and(eq(mailboxAccess.userId, userId), eq(mailboxes.disabled, false))),
  ])
  return [...new Set([...owned, ...delegated].map((item) => item.id))]
}

export async function queueOutboundEmail(
  env: CloudflareEnv,
  userId: string,
  input: { mailboxId: string; to: string; subject: string; text: string; html?: string; attachments?: Array<Attachment>; scheduledAt?: Date; draftId?: string },
) {
  if (!parseAddress(input.to)) throw new Error('Invalid recipient address')
  if (input.subject.length > 998) throw new Error('Subject is too long')
  if (input.text.length > 2_000_000 || (input.html?.length ?? 0) > 2_000_000) throw new Error('Message is too large')

  const db = getDb(env.DB)
  const mailbox = (await db
    .select({ mailbox: mailboxes, hostname: domains.hostname })
    .from(mailboxes)
    .innerJoin(domains, eq(mailboxes.domainId, domains.id))
    .where(and(eq(mailboxes.id, input.mailboxId), eq(mailboxes.disabled, false)))
    .limit(1)).at(0)
  if (!mailbox) throw new Error('Mailbox not found')

  const owner = mailbox.mailbox.userId === userId
  const access = owner
    ? null
    : (await db.select().from(mailboxAccess).where(and(eq(mailboxAccess.mailboxId, input.mailboxId), eq(mailboxAccess.userId, userId))).limit(1)).at(0)
  if (!owner && !access) throw new Error('Mailbox access denied')
  if (access?.permission === 'read_only') throw new Error('This mailbox is read-only')

  const address = `${mailbox.mailbox.localPart}@${mailbox.hostname}`
  const actor = access?.permission === 'send_on_behalf'
    ? (await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1)).at(0)
    : null
  const from = formatAddress(
    address,
    actor ? `${actor.name} on behalf of ${mailbox.mailbox.displayName || address}` : mailbox.mailbox.displayName,
  )
  const text = mailbox.mailbox.signature ? `${input.text}\n\n${mailbox.mailbox.signature}` : input.text
  const messageId = newId('msg')
  const jobId = newId('job')
  const payload: OutboundQueueMessage = {
    type: 'outbound-mail',
    jobId,
    messageId,
    from,
    to: input.to,
    subject: input.subject,
    text,
    html: input.html,
  }

  await db.batch([
    db.insert(messages).values({
      id: messageId,
      userId,
      mailboxId: input.mailboxId,
      direction: 'outbound',
      fromAddr: from,
      toAddr: input.to,
      subject: input.subject,
      snippet: text.replace(/\s+/g, ' ').slice(0, 200),
      textBody: text,
      htmlBody: input.html,
      status: input.scheduledAt && input.scheduledAt > new Date() ? 'scheduled' : 'queued',
    }),
    db.insert(outboundJobs).values({ id: jobId, userId, messageId, payload: JSON.stringify(payload), scheduledAt: input.scheduledAt }),
  ])
  try {
    await storeAttachments(env, messageId, input.attachments ?? [])
    if (!input.scheduledAt || input.scheduledAt <= new Date()) await env.OUTBOUND_QUEUE.send(payload)
    if (input.draftId) await db.delete(messages).where(and(eq(messages.id, input.draftId), eq(messages.userId, userId), eq(messages.status, 'draft')))
    const recipient = parseAddress(input.to)?.address
    if (recipient) await db.insert(contacts).values({ id: newId('con'), userId, email: recipient, source: 'outbound', lastSeenAt: new Date() }).onConflictDoUpdate({ target: [contacts.userId, contacts.email], set: { lastSeenAt: new Date() } })
  } catch (error) {
    await db.batch([
      db.delete(outboundJobs).where(eq(outboundJobs.id, jobId)),
      db.delete(messages).where(eq(messages.id, messageId)),
    ])
    throw error
  }
  return { messageId }
}

export async function processOutboundEmail(env: CloudflareEnv, payload: OutboundQueueMessage) {
  const db = getDb(env.DB)
  const job = (await db.select().from(outboundJobs).where(eq(outboundJobs.id, payload.jobId)).limit(1)).at(0)
  if (!job || job.status === 'sent') return
  if (job.status === 'processing' && Date.now() - job.updatedAt.getTime() < 45_000) throw new Error('Outbound job is already processing')
  const claimed = await db.update(outboundJobs).set({ status: 'processing', updatedAt: new Date() }).where(and(eq(outboundJobs.id, payload.jobId), job.status === 'processing' ? and(eq(outboundJobs.status, 'processing'), eq(outboundJobs.updatedAt, job.updatedAt)) : inArray(outboundJobs.status, ['queued', 'failed']))).returning({ id: outboundJobs.id })
  if (!claimed.length) return

  try {
    const rows = await db.select().from(messageAttachments).where(eq(messageAttachments.messageId, payload.messageId))
    const attachments = await Promise.all(rows.map(async (attachment) => {
      const object = await env.BUCKET.get(attachment.r2Key)
      if (!object) throw new Error(`Missing attachment ${attachment.id}`)
      const common = {
        filename: attachment.filename,
        type: attachment.contentType,
        content: await object.arrayBuffer(),
      }
      return attachment.disposition === 'inline' && attachment.contentId
        ? { ...common, disposition: 'inline' as const, contentId: attachment.contentId }
        : { ...common, disposition: 'attachment' as const }
    }))
    const response = await env.EMAIL.send({
      from: payload.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      attachments,
    })
    await db.batch([
      db.update(messages).set({ status: 'sent', providerMessageId: response.messageId }).where(eq(messages.id, payload.messageId)),
      db.update(outboundJobs).set({ status: 'sent', error: null, updatedAt: new Date() }).where(eq(outboundJobs.id, payload.jobId)),
    ])
    await enqueueWebhookEvent(env, job.userId, 'message.sent', { messageId: payload.messageId, from: payload.from, to: payload.to, subject: payload.subject }).catch((error) => console.error('Webhook enqueue failed', error))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Send failed'
    await db.batch([
      db.update(messages).set({ status: 'failed' }).where(eq(messages.id, payload.messageId)),
      db.update(outboundJobs).set({ status: 'failed', error: message, updatedAt: new Date() }).where(eq(outboundJobs.id, payload.jobId)),
    ])
    throw error
  }
}

export async function queueScheduledEmails(env: CloudflareEnv) {
  const db = getDb(env.DB)
  const due = await db.select().from(outboundJobs).where(and(
    eq(outboundJobs.status, 'queued'),
    isNotNull(outboundJobs.scheduledAt),
    lte(outboundJobs.scheduledAt, new Date()),
  )).limit(100)
  for (const job of due) {
    await db.update(outboundJobs).set({ scheduledAt: null, updatedAt: new Date() }).where(eq(outboundJobs.id, job.id))
    try {
      await env.OUTBOUND_QUEUE.send(JSON.parse(job.payload) as OutboundQueueMessage)
    } catch (error) {
      await db.update(outboundJobs).set({ scheduledAt: job.scheduledAt }).where(eq(outboundJobs.id, job.id))
      throw error
    }
  }
}

export function getMessagesByIds(ids: Array<string>) {
  if (!ids.length) return []
  return getDb().select().from(messages).where(inArray(messages.id, ids))
}
